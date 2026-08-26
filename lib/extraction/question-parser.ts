import { randomUUID } from 'crypto';
import { Question } from '../domain/types';
import { QuestionSchema } from '../validation/schemas';
import { ExtractedPageText } from './text-extractor';

interface ParsedRawBlock {
  number: string;
  text: string;
  parentNumber?: string;
  subPart?: string;
  alternativeText?: string;
  alternativeType?: 'visually_impaired';
}

/**
 * Checks if a line is an administrative header, footer, or page number line.
 */
export function isHeaderOrFooterLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;

  // Single standalone page numbers or "Page X of Y" or CBSE footer patterns
  if (/^page\s+\d+(\s+of\s+\d+)?$/i.test(trimmed)) return true;
  if (/^\d+\s*\/\s*\d+$/.test(trimmed)) return true;
  if (/^\*?Please note that the assessment scheme/i.test(trimmed)) return true;
  if (/^\d{4}-\d{2}\.\s*Page\s+\d+\s+of\s+\d+/i.test(trimmed)) return true;

  // Common exam metadata headers
  const headerPatterns = [
    /^(time allowed|time|duration)\s*[:=]/i,
    /^(maximum marks|max marks|total marks|marks)\s*[:=]/i,
    /^(course code|subject code|course name|subject name)\s*[:=]/i,
    /^(register number|reg no|roll no|student id)\s*[:=]/i,
    /^(continuous internal assessment|semester examination|end semester exam|cia[- ]?\d*)/i,
    /^(\*+|\-{3,}|_{3,})$/, // Horizontal rules
    /^(end of question paper|all the best|good luck)\.?$/i,
    /^MATHEMATICS\s*[–-]\s*Code/i,
    /^SAMPLE QUESTION PAPER/i,
    /^CLASS\s*-\s*XII/i,
    /^Q\.No\.\s*Questions\s*Marks/i,
  ];

  return headerPatterns.some((pattern) => pattern.test(trimmed));
}

/**
 * Normalizes question numbering and parses sub-parts.
 * Examples:
 *   "11(a)" -> { number: "11(a)", parentNumber: "11", subPart: "a" }
 *   "21A"   -> { number: "21A",   parentNumber: "21", subPart: "a" }
 *   "11 (a)" -> { number: "11(a)", parentNumber: "11", subPart: "a" }
 *   "1" -> { number: "1", parentNumber: undefined, subPart: undefined }
 */
export function parseQuestionLabel(label: string): {
  number: string;
  parentNumber?: string;
  subPart?: string;
} {
  const clean = label.trim().replace(/^Q(?:uestion)?\.?\s*/i, '');

  // Match alphanumeric compound: "21A", "21B", "11(a)", "11 (a)", "11. (a)", "11.a"
  const compoundMatch = clean.match(/^(\d+)\s*[.:\-]?\s*\(?([a-zA-Z]|[ivxlcdm]+(?:\s+[a-zA-Z])?)\)?\.?$/i);
  if (compoundMatch) {
    const parent = compoundMatch[1];
    const subRaw = compoundMatch[2];
    const sub = subRaw.toLowerCase().replace(/[()]/g, '').trim();
    // Preserve uppercase letter for labels like 21A, 21B if originally uppercase alphanumeric without parens
    const isAlphanumericTag = /^[A-Z]$/.test(subRaw) && !clean.includes('(');
    const displayLabel = isAlphanumericTag ? `${parent}${subRaw.toUpperCase()}` : `${parent}(${sub})`;
    return {
      number: displayLabel,
      parentNumber: parent,
      subPart: sub,
    };
  }

  // Pure sub-part "(a)", "(b)", "a."
  const subOnlyMatch = clean.match(/^\(?([a-zA-Z]|[ivxlcdm]+(?:\s+[a-zA-Z])?)\)?\.?$/i);
  if (subOnlyMatch && !/^\d+$/.test(clean)) {
    const sub = subOnlyMatch[1].toLowerCase().replace(/[()]/g, '').trim();
    return {
      number: `(${sub})`,
      parentNumber: undefined,
      subPart: sub,
    };
  }

  // Standard top-level number "1", "12"
  const topLevelMatch = clean.match(/^(\d+)\.?$/);
  if (topLevelMatch) {
    return {
      number: topLevelMatch[1],
      parentNumber: undefined,
      subPart: undefined,
    };
  }

  return {
    number: clean,
    parentNumber: undefined,
    subPart: undefined,
  };
}

function findTargetBlock(
  blocks: ParsedRawBlock[],
  currentBlock: ParsedRawBlock | null,
  targetNum: string
): ParsedRawBlock | null {
  if (currentBlock && currentBlock.number === targetNum) {
    return currentBlock;
  }
  const found = blocks.find((b) => b.number === targetNum);
  if (found) return found;
  return null;
}

/**
 * Parses raw text lines into structured Question domain records deterministically.
 */
export function parseQuestionsFromLines(pages: ExtractedPageText[]): Question[] {
  const blocks: ParsedRawBlock[] = [];
  let inInstructions = false;
  let inVisuallyImpairedSection = false;
  let activeAlternativeTarget: ParsedRawBlock | null = null;
  let activeParent: string | undefined = undefined;
  let currentBlock: ParsedRawBlock | null = null;

  for (const page of pages) {
    for (const rawLine of page.lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // 1. Handle Instruction block start (e.g. Page 1 General Instructions)
      if (/^(?:general\s+instructions?|instructions?\s*(?:to\s+candidates)?)\s*[:=]?$/i.test(line)) {
        inInstructions = true;
        continue;
      }
      if (inInstructions) {
        if (/^SECTION\s*[-–]?\s*[A-E]/i.test(line) || /^PART\s*[-–]?\s*[A-E]/i.test(line)) {
          inInstructions = false;
        } else {
          continue;
        }
      }

      // 2. Skip administrative headers / footers
      if (isHeaderOrFooterLine(line)) {
        continue;
      }

      // 3. Skip section delimiters and instructional headers
      if (/^SECTION\s*[-–]?\s*[A-E]/i.test(line) || /^ASSERTION\s*-\s*REASON/i.test(line)) {
        inVisuallyImpairedSection = false;
        activeAlternativeTarget = null;
        continue;
      }
      if (
        /^This section comprises/i.test(line) ||
        /^Select the correct option/i.test(line) ||
        /^\(Question numbers 19 and 20 are Assertion/i.test(line)
      ) {
        continue;
      }

      // 4. Standalone "OR" / "O R" lines (internal choice connectors)
      if (/^O\s*R$/i.test(line)) {
        if (inVisuallyImpairedSection && activeAlternativeTarget) {
          activeAlternativeTarget.alternativeText = activeAlternativeTarget.alternativeText
            ? `${activeAlternativeTarget.alternativeText} OR`
            : 'OR';
        } else if (currentBlock) {
          currentBlock.text += ' OR';
        }
        continue;
      }

      // 5. "For Visually Impaired" marker lines
      // e.g. "For Visually Impaired:", "16 . For Visually Impaired:", "23 B For Visually Impaired:", "30 For Visually Impaired:"
      const viHeaderMatch = line.match(
        /^(?:(\d{1,3})\s*([A-Da-d]|\([A-Da-d]\))?\s*[.:\s]*)?For Visually Impaired\s*[:\s]*(.*)$/i
      );
      if (viHeaderMatch) {
        inVisuallyImpairedSection = true;
        const num = viHeaderMatch[1];
        const sub = viHeaderMatch[2];
        const trailingText = viHeaderMatch[3]?.trim();

        let targetNum = num;
        if (num && sub) {
          const subClean = sub.toLowerCase().replace(/[()]/g, '');
          const isAlphanumericTag = /^[A-Z]$/.test(sub) && !viHeaderMatch[0].includes('(');
          targetNum = isAlphanumericTag ? `${num}${sub}` : `${num}(${subClean})`;
        }

        if (targetNum) {
          activeAlternativeTarget = findTargetBlock(blocks, currentBlock, targetNum);
        } else {
          activeAlternativeTarget = currentBlock;
        }

        if (activeAlternativeTarget) {
          activeAlternativeTarget.alternativeType = 'visually_impaired';
          if (trailingText) {
            activeAlternativeTarget.alternativeText = activeAlternativeTarget.alternativeText
              ? `${activeAlternativeTarget.alternativeText} ${trailingText}`
              : trailingText;
          }
        }
        continue;
      }

      let matched = false;

      // -------------------------------------------------------------
      // Pattern 1: Compound Alphanumeric Question: "21A", "21B", "11(a)", "11 (a)", "26A .", "33A", "34B"
      // -------------------------------------------------------------
      const compoundMatch = line.match(/^(\d{1,3})\s*([A-Da-d]|\([A-Da-d]\))(?:\s*[.:\-]\s*|\s+|$)(.*)$/);
      if (compoundMatch) {
        const num = compoundMatch[1];
        const subRaw = compoundMatch[2];
        const rest = compoundMatch[3].trim();
        const numVal = parseInt(num, 10);

        // Distinguish from article "A" followed by an English noun (e.g. "27 A spherical ball", "A bird")
        const isArticleWord = /^(spherical|bird|student|man|person|city|company|function|matrix|determinant|vector|two|three|four|five|line|point|circle|box)\b/i.test(
          rest
        );

        if (numVal >= 1 && numVal <= 100 && !isArticleWord) {
          const subClean = subRaw.toLowerCase().replace(/[()]/g, '').trim();
          const hasParensInTag = compoundMatch[2].includes('(');
          const isAlphanumericTag = /^[A-Z]$/.test(subRaw) && !hasParensInTag;
          const displayLabel = isAlphanumericTag ? `${num}${subRaw}` : `${num}(${subClean})`;

          // If we are currently in visually impaired section, attach to existing question
          if (inVisuallyImpairedSection) {
            const target = findTargetBlock(blocks, currentBlock, displayLabel);
            if (target) {
              target.alternativeType = 'visually_impaired';
              target.alternativeText = target.alternativeText
                ? `${target.alternativeText} ${rest}`
                : rest;
              activeAlternativeTarget = target;
              matched = true;
            }
          }

          if (!matched) {
            if (currentBlock) blocks.push(currentBlock);
            activeParent = num;
            inVisuallyImpairedSection = false;
            activeAlternativeTarget = null;
            currentBlock = {
              number: displayLabel,
              parentNumber: num,
              subPart: subClean,
              text: rest,
            };
            matched = true;
          }
        }
      }

      // -------------------------------------------------------------
      // Pattern 2: Top-level Question: "1.", "1 .", "2.", "22 If...", "27 A spherical...", "32 .", "36 . Case Study"
      // -------------------------------------------------------------
      if (!matched) {
        const topMatch = line.match(/^(?:Q(?:uestion)?[\s.:]*)?(\d{1,3})(?:\s*[.:)]|\s+(?=[A-Za-z]))\s*(.*)$/i);
        if (topMatch) {
          const num = topMatch[1];
          const rest = topMatch[2].trim();
          const numVal = parseInt(num, 10);

          if (numVal >= 1 && numVal <= 100) {
            // Avoid matching numbered items inside case study text (e.g. "1. Traffic flows from A to B")
            const isCaseStudyBullet = activeParent && ['36', '37', '38'].includes(activeParent) && numVal <= 4 && !rest.startsWith('Case Study');
            const isSplitMathFormula = /^[)\]]\s*[+\-×÷=,]/.test(rest) || (line.includes('λ') && !rest.includes('A bird'));
            const isEquationLine = /^[xyz]\s*[+\-=]/.test(rest) || /^[+\-]\s*\d+\s*[xyz]/.test(rest);

            if (!isCaseStudyBullet && !isSplitMathFormula && !isEquationLine) {
              if (inVisuallyImpairedSection) {
                const target = findTargetBlock(blocks, currentBlock, num);
                if (target) {
                  target.alternativeType = 'visually_impaired';
                  target.alternativeText = target.alternativeText
                    ? `${target.alternativeText} ${rest}`
                    : rest;
                  activeAlternativeTarget = target;
                  matched = true;
                }
              }

              if (!matched) {
                if (currentBlock) blocks.push(currentBlock);
                activeParent = num;
                inVisuallyImpairedSection = false;
                activeAlternativeTarget = null;
                currentBlock = {
                  number: num,
                  parentNumber: undefined,
                  subPart: undefined,
                  text: rest,
                };
                matched = true;
              }
            }
          }
        }
      }

      // -------------------------------------------------------------
      // Pattern 3: Case Study Roman Sub-parts: "I.", "II.", "III A.", "III B.", "III A .", "III B ."
      // -------------------------------------------------------------
      if (!matched && activeParent && ['36', '37', '38'].includes(activeParent)) {
        const caseSubMatch = line.match(/^(I{1,3}|IV|V)\s*([A-Za-z])?\s*[.:]\s*(.*)$/i);
        if (caseSubMatch) {
          const roman = caseSubMatch[1].toUpperCase();
          const letter = caseSubMatch[2] ? caseSubMatch[2].toUpperCase() : '';
          const rest = caseSubMatch[3].trim();
          const subLabel = letter ? `${roman} ${letter}` : roman;

          if (currentBlock) blocks.push(currentBlock);
          inVisuallyImpairedSection = false;
          activeAlternativeTarget = null;
          currentBlock = {
            number: `${activeParent}(${subLabel})`,
            parentNumber: activeParent,
            subPart: subLabel.toLowerCase(),
            text: rest,
          };
          matched = true;
        }
      }

      // -------------------------------------------------------------
      // Continuation of current question or alternative text
      // -------------------------------------------------------------
      if (!matched) {
        if (inVisuallyImpairedSection && activeAlternativeTarget) {
          activeAlternativeTarget.alternativeText = activeAlternativeTarget.alternativeText
            ? `${activeAlternativeTarget.alternativeText} ${line}`
            : line;
        } else if (currentBlock) {
          currentBlock.text = currentBlock.text
            ? `${currentBlock.text} ${line}`
            : line;
        }
      }
    }
  }

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  // Convert to validated Question domain objects with deterministic order
  return blocks.map((b, idx) => {
    const q: Question = {
      id: randomUUID(),
      number: b.number,
      text: b.text || b.number,
      order: idx,
      parentNumber: b.parentNumber,
      subPart: b.subPart,
      alternativeText: b.alternativeText,
      alternativeType: b.alternativeType,
    };
    return QuestionSchema.parse(q);
  });
}
