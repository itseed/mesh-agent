import type { ReviewIssue } from './styles';

export function parseReviewIssues(commentBody: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const summaryLine =
    commentBody.match(/\*\*สรุป:\*\*\s*(.+)/)?.[1] ??
    commentBody.match(/summary:\s*(.+)/i)?.[1] ??
    '';

  const groups: Array<{ re: RegExp; severity: ReviewIssue['severity'] }> = [
    { re: /CRITICAL\s+\d+\s+จุด\s*\(([^)]+)\)/i, severity: 'critical' },
    { re: /HIGH\s+\d+\s+จุด\s*\(([^)]+)\)/i, severity: 'high' },
    { re: /MEDIUM\s+\d+\s+จุด\s*\(([^)]+)\)/i, severity: 'medium' },
    { re: /LOW\s+\d+\s+จุด\s*\(([^)]+)\)/i, severity: 'low' },
  ];
  for (const { re, severity } of groups) {
    const m = summaryLine.match(re);
    if (m)
      m[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((title) => issues.push({ title, severity }));
  }

  // Fallback: **N. title** numbered items from outputLog excerpt
  if (issues.length === 0) {
    for (const m of commentBody.matchAll(/\*\*\d+\.\s*`?([^`*\n]{1,80})`?\*\*/g)) {
      const title = m[1].trim();
      if (title.length >= 3) issues.push({ title, severity: 'medium' });
    }
  }

  return issues;
}

export function filterNoise(output: string): string {
  return output
    .split('\n')
    .filter(
      (line) =>
        !line.startsWith('[warn] workingDir') &&
        !line.includes('SessionEnd hook') &&
        !line.includes('Cannot find module') &&
        !line.includes('requireStack'),
    )
    .join('\n')
    .trim();
}
