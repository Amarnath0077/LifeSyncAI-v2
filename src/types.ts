/**
 * Shared Type Definitions for the Recurring Challenges System
 */

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface Challenge {
  id: string;
  userId: string;
  name: string;
  startDate: string; // YYYY-MM-DD
  durationDays: number; // 7, 30, 60, 90, 180, or custom
  dailyTasks: string[]; // List of tasks to complete daily
  createdAt: string;
}

export interface ChallengeDailyLog {
  id: string;
  challengeId: string;
  userId: string;
  date: string; // YYYY-MM-DD
  taskTitle: string;
  status: "Completed" | "Skipped" | "Partial" | "Uncompleted";
}

export interface AuthSession {
  isLoggedIn: boolean;
  user: User | null;
}

export interface ChallengeStats {
  daysCompleted: number; // Days with at least one Completed or Partial task
  daysRemaining: number;
  daysElapsed: number;
  completionPercentage: number; // (CompletedTasks + 0.5 * PartialTasks) / (TotalPossibleTasksSoFar) * 100
  currentStreak: number;
}

export interface UserNote {
  id: string;
  userId: string;
  challengeId?: string;
  date: string; // YYYY-MM-DD
  content: string;
  createdAt: string;
}

export interface UserGoal {
  id: string;
  userId: string;
  challengeId?: string;
  title: string;
  targetDate: string; // YYYY-MM-DD
  completed: boolean;
  completedAt?: string;
  createdAt: string;
}

export interface Achievement {
  id: string;
  userId: string;
  title: string;
  description: string;
  unlockedAt: string;
}

export interface NotificationSetting {
  userId: string;
  morningEnabled: boolean;
  eveningEnabled: boolean;
  eodEnabled: boolean;
  emailEnabled: boolean;
  pushEnabled: boolean;
  inAppEnabled: boolean;
  
  // Custom Email notification settings
  emailProvider?: "sandbox" | "resend" | "sendgrid" | "smtp" | "gmail";
  emailApiKey?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  smtpFrom?: string;
  
  morningTime?: string; // HH:MM format
  eveningTime?: string; // HH:MM format
  eodTime?: string;     // HH:MM format
  weeklyReportDay?: number; // 0 for Sunday, etc.
  monthlyReportDay?: "last" | "first" | string;
}

export interface EmailDeliveryLog {
  id: string;
  userId: string;
  to: string;
  subject: string;
  html: string;
  campaign: "morning" | "evening" | "eod" | "weekly" | "monthly" | "system";
  status: "success" | "failed";
  retryCount: number;
  providerUsed: string;
  sentAt: string;
  error?: string;
}

export interface InAppNotification {
  id: string;
  userId: string;
  type: "morning" | "evening" | "eod" | "system";
  title: string;
  message: string;
  date: string; // YYYY-MM-DD
  read: boolean;
  createdAt: string;
}

export interface ProgressReport {
  id: string;
  userId: string;
  type: "weekly" | "monthly";
  periodStr: string; // e.g. "Week of June 9, 2026" or "June 2026"
  dateKey: string;
  completionRate: number;
  totalHours: number;
  bestDay: string;
  weakestDay: string;
  streak: number;
  score: number; // calculated custom productivity score
  suggestionsOrForecast: string;
  createdAt: string;
}

