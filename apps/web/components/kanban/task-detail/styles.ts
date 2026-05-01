export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface ReviewIssue {
  title: string;
  severity: Severity;
}

export const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-dim',
};

export const ROLE_STYLE: Record<string, { bg: string; text: string }> = {
  frontend: { bg: 'rgba(34,211,238,0.1)', text: '#22d3ee' },
  backend: { bg: 'rgba(96,165,250,0.1)', text: '#60a5fa' },
  mobile: { bg: 'rgba(192,132,252,0.1)', text: '#c084fc' },
  devops: { bg: 'rgba(74,222,128,0.1)', text: '#4ade80' },
  designer: { bg: 'rgba(244,114,182,0.1)', text: '#f472b6' },
  qa: { bg: 'rgba(251,146,60,0.1)', text: '#fb923c' },
  reviewer: { bg: 'rgba(248,113,113,0.1)', text: '#f87171' },
};

export const PRIORITY_BG: Record<string, string> = {
  urgent: 'rgba(248,113,113,0.15)',
  high: 'rgba(251,146,60,0.15)',
  medium: 'rgba(251,191,36,0.15)',
  low: 'rgba(55,69,86,0.3)',
};

export const PRIORITY_TEXT: Record<string, string> = {
  urgent: '#f87171',
  high: '#fb923c',
  medium: '#fbbf24',
  low: '#6a7a8e',
};

export const SEVERITY_STYLE: Record<string, { backgroundColor: string; color: string }> = {
  critical: { backgroundColor: 'rgba(248,113,113,0.15)', color: '#f87171' },
  high: { backgroundColor: 'rgba(251,146,60,0.15)', color: '#fb923c' },
  medium: { backgroundColor: 'rgba(251,191,36,0.15)', color: '#fbbf24' },
  low: { backgroundColor: 'rgba(107,114,128,0.15)', color: '#9ca3af' },
};

export const STAGE_COLORS: Record<string, string> = {
  backlog: '#6a7a8e',
  in_progress: '#f0883e',
  review: '#d2a8ff',
  done: '#3fb950',
};
