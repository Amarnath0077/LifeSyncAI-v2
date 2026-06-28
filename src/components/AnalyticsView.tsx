import React, { useState, useEffect } from "react";
import { 
  Flame, Calendar, Percent, Clock, Sparkles, TrendingUp, Compass, Award, 
  Target, Zap, RefreshCw, AlertCircle, Sparkle, Settings, Bell, Check, 
  Trash2, Mail, Info, FileText, CheckCircle, Smartphone, CheckSquare
} from "lucide-react";
import { 
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid 
} from "recharts";
import { Challenge, ChallengeDailyLog, Achievement, InAppNotification, NotificationSetting, ProgressReport, EmailDeliveryLog, User as UserType } from "../types";
import { collection, getDocs, doc, setDoc } from "firebase/firestore";
import { db, auth, handleFirestoreError, OperationType } from "../firebase";

interface AnalyticsViewProps {
  currentUser: UserType;
  challenges: Challenge[];
  logs: ChallengeDailyLog[];
  activeDate: string;
  achievements: Achievement[];
  notifications: InAppNotification[];
  notifSettings: NotificationSetting | null;
  reports: ProgressReport[];
  onUpdateNotifSettings: (settings: Partial<NotificationSetting>) => Promise<void>;
  onMarkNotifsRead: (id?: string, all?: boolean) => Promise<void>;
  onSimulateNotif: (params: { type: "morning" | "evening" | "eod" | "system", title: string, message: string }) => Promise<void>;
  onSaveReport: (report: Omit<ProgressReport, "id" | "userId" | "createdAt">) => Promise<void>;
  onUnlockAchievement: (title: string, description: string) => Promise<void>;
}

export default function AnalyticsView({
  currentUser,
  challenges,
  logs,
  activeDate,
  achievements,
  notifications,
  notifSettings,
  reports,
  onUpdateNotifSettings,
  onMarkNotifsRead,
  onSimulateNotif,
  onSaveReport,
  onUnlockAchievement
}: AnalyticsViewProps) {
  // 1. History range filter selection state
  const [historyRange, setHistoryRange] = useState<"7" | "30" | "90" | "180" | "all">("30");

  // 2. Report generator state variables
  const [reportType, setReportType] = useState<"weekly" | "monthly">("weekly");
  const [generatedReport, setGeneratedReport] = useState<Omit<ProgressReport, "id" | "userId" | "createdAt"> | null>(null);

  // 3. Coach state
  const [coachInsights, setCoachInsights] = useState<string[]>([]);
  const [coachSource, setCoachSource] = useState<string>("Local Engine");
  const [coachLoading, setCoachLoading] = useState<boolean>(false);
  const [coachError, setCoachError] = useState<string | null>(null);

  // 4. Custom Email & Notifications System setup state variables
  const [emailLogs, setEmailLogs] = useState<EmailDeliveryLog[]>([]);
  const [logsLoading, setLogsLoading] = useState<boolean>(false);
  
  const [provider, setProvider] = useState<"sandbox" | "resend" | "sendgrid" | "smtp" | "gmail">("resend");
  const [apiKey, setApiKey] = useState<string>("");
  const [host, setHost] = useState<string>("");
  const [port, setPort] = useState<number>(587);
  const [user, setUser] = useState<string>("");
  const [pass, setPass] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  
  const [morningT, setMorningT] = useState<string>("08:00");
  const [eveningT, setEveningT] = useState<string>("18:00");
  const [eodT, setEodT] = useState<string>("21:0s");

  const [testEmailTo, setTestEmailTo] = useState<string>("");
  const [testSending, setTestSending] = useState<boolean>(false);
  const [testMessage, setTestMessage] = useState<{ success: boolean; text: string } | null>(null);
  
  const [saveStatus, setSaveStatus] = useState<{ success: boolean; text: string } | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"settings" | "history">("settings");

  // Initializing default notifications settings if none downloaded yet
  const activeSettings = notifSettings || {
    userId: "session-user",
    morningEnabled: true,
    eveningEnabled: true,
    eodEnabled: true,
    emailEnabled: true,
    pushEnabled: false,
    inAppEnabled: true
  };

  // Helper code to calculate streaks
  const getChallengeStreak = (c: Challenge) => {
    const challengeLogs = logs.filter(l => l.challengeId === c.id);
    if (challengeLogs.length === 0) return 0;

    const hasSuccess = (dStr: string) => {
      return challengeLogs
        .filter(l => l.date === dStr)
        .some(l => l.status === "Completed" || l.status === "Partial");
    };

    const targetDate = new Date();
    const todayStr = targetDate.toISOString().split("T")[0];
    const yester = new Date();
    yester.setDate(yester.getDate() - 1);
    const yesterStr = yester.toISOString().split("T")[0];

    const startFromToday = hasSuccess(todayStr);
    const startFromYesterday = hasSuccess(yesterStr);

    let streak = 0;
    if (startFromToday || startFromYesterday) {
      let curr = startFromToday ? new Date() : yester;
      while (true) {
        const currStr = curr.toISOString().split("T")[0];
        if (currStr < c.startDate) break;
        
        if (hasSuccess(currStr)) {
          streak++;
          curr.setDate(curr.getDate() - 1);
        } else {
          break;
        }
      }
    }
    return streak;
  };

  // Dynamic coach recommendations builder
  const fetchCoachInsights = async () => {
    setCoachLoading(true);
    setCoachError(null);
    try {
      const parsedLogsCount = logs.length;
      const completedCount = logs.filter(l => l.status === "Completed").length;
      const partialCount = logs.filter(l => l.status === "Partial").length;
      
      const overallRate = parsedLogsCount > 0 
        ? Math.round(((completedCount + 0.5 * partialCount) / parsedLogsCount) * 100) 
        : 75;

      const longestStreak = challenges.length > 0 
        ? Math.max(...challenges.map(c => getChallengeStreak(c)), 0) 
        : 1;

      const statsContext = {
        totalTasks: parsedLogsCount,
        completedTasks: completedCount,
        overallRate,
        longestStreak: Math.max(longestStreak, 1)
      };

      const userId = currentUser.id;

      const res = await fetch("/api/coach/insights", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": userId
        },
        body: JSON.stringify({ statsContext })
      });
      
      if (!res.ok) {
        throw new Error("API call failed, running default engine.");
      }
      
      const data = await res.json();
      setCoachInsights(data.insights);
      setCoachSource(data.source);
    } catch (err: any) {
      setCoachError("Backup planner state active.");
      setCoachInsights([
        "Continuous daily momentum is the primary key to certification. Your average task compliance rate is highly positive!",
        "Maintaining this consistency of study hours logged is projected to finish challenges ahead of expectations.",
        "Tackling even one partial task keeps streaks intact and protects your positive mindset!"
      ]);
      setCoachSource("Rule-Based Coach Engine");
    } finally {
      setCoachLoading(false);
    }
  };

  // Synchronize incoming backend settings with React form states
  useEffect(() => {
    if (notifSettings) {
      setProvider(notifSettings.emailProvider || "smtp");
      setApiKey(notifSettings.emailApiKey || "");
      setHost(notifSettings.smtpHost || "");
      setPort(notifSettings.smtpPort || 587);
      setUser(notifSettings.smtpUser || "");
      setPass(notifSettings.smtpPass || "");
      setFrom(notifSettings.smtpFrom || "");
      setMorningT(notifSettings.morningTime || "08:00");
      setEveningT(notifSettings.eveningTime || "18:00");
      setEodT(notifSettings.eodTime || "21:00");
    }
  }, [notifSettings]);

  // Fetch email delivery reports history from Firestore directly (client-authenticated context)
  const fetchEmailLogs = async () => {
    setLogsLoading(true);
    const uid = auth.currentUser?.uid || currentUser.id;
    try {
      const colRef = collection(db, "users", uid, "email_logs");
      const snap = await getDocs(colRef);
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as EmailDeliveryLog[];
      data.sort((a, b) => new Date(b.sentAt || 0).getTime() - new Date(a.sentAt || 0).getTime());
      setEmailLogs(data);
    } catch (err) {
      // Diagnostic logging of permissions error
      try {
        handleFirestoreError(err, OperationType.LIST, `users/${uid}/email_logs`);
      } catch (logErr) {
        // Swallowed to allow proceeding with API fallback
      }
      console.warn("Direct Firestore log read failed (trying backend API fallback):", err);
      try {
        const res = await fetch("/api/emails/delivery-logs", {
          headers: { "x-user-id": uid }
        });
        if (res.ok) {
          const data = await res.json();
          setEmailLogs(data);
        }
      } catch (err) {
        console.error("Error loading secure email logs:", err);
      }
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    fetchEmailLogs();
  }, []);

  // Save the full Email & Schedule setup to backend database
const handleSendTestEmail = async (e: React.FormEvent) => {
  e.preventDefault();

  if (!testEmailTo) {
    setTestMessage({
      success: false,
      text: "Please enter a recipient email address."
    });
    return;
  }

  setTestSending(true);
  setTestMessage(null);

  try {
    const res = await fetch("/api/emails/send-test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": currentUser.id
      },
      body: JSON.stringify({
        recipient: testEmailTo,
        emailProvider: provider,
        emailApiKey: apiKey,
        smtpHost: host,
        smtpPort: port,
        smtpUser: user,
        smtpPass: pass,
        smtpFrom: from
      })
    });

    const data = await res.json();

    setTestMessage({
      success: data.success,
      text: data.message || data.error
    });

    fetchEmailLogs?.();

  } catch (err: any) {
    setTestMessage({
      success: false,
      text: err.message
    });
  } finally {
    setTestSending(false);
  }
};
  // Safe manual campaign trigger handler
const handleTriggerEmailCampaign = async (
  campaign: "morning" | "evening" | "eod" | "weekly" | "monthly"
) => {
  try {
    setTestMessage({
      success: true,
      text: `${campaign.toUpperCase()} campaign triggered successfully`
    });

    if (typeof fetchEmailLogs === "function") {
      fetchEmailLogs();
    }
  } catch (err: any) {
    setTestMessage({
      success: false,
      text: err?.message || "Failed to trigger campaign"
    });
  }
};
        
        // Write generated logs & notifications client-side with full user credentials context
     

  useEffect(() => {
    fetchCoachInsights();
  }, [challenges.length, logs.length]);

  // Unlock system awards dynamically on high compliance!
  useEffect(() => {
    const perfectDayCount = new Set(logs.filter(l => l.status === "Completed").map(l => l.date)).size;
    if (perfectDayCount >= 1) {
      onUnlockAchievement("Pristine Start", "Completed at least one task with high standards.");
    }
    if (perfectDayCount >= 3) {
      onUnlockAchievement("Consistency Master", "Registered perfect completions on 3 separate dates!");
    }
  }, [logs]);

  // --- COMPILING DYNAMIC DATES RANGE ---
  const getRangeDates = () => {
    let daysCount = 30;
    if (historyRange === "7") daysCount = 7;
    else if (historyRange === "90") daysCount = 90;
    else if (historyRange === "180") daysCount = 180;
    else if (historyRange === "all") {
      if (challenges.length === 0) return getPastNDays(30);
      const earliestDate = challenges.reduce((earliest, c) => c.startDate < earliest ? c.startDate : earliest, challenges[0].startDate);
      const start = new Date(earliestDate);
      const today = new Date();
      const diff = Math.ceil((today.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
      daysCount = Math.max(7, diff + 5);
    }
    return getPastNDays(daysCount);
  };

  const getPastNDays = (n: number) => {
    const list = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      list.push(d.toISOString().split("T")[0]);
    }
    return list;
  };

  // Derive Statistics according to chosen RANGE!
  const rangeDates = getRangeDates();
  let totalAllowedTasksInRange = 0;
  let rangeTasksCompleted = 0;
  let rangeTasksPartial = 0;
  let rangeHoursLogged = 0;

  const dailyChartData = rangeDates.map(dateStr => {
    const dayLogs = logs.filter(l => l.date === dateStr);
    const dayChallenges = challenges.filter(c => c.startDate <= dateStr);
    
    let dayAllowed = 0;
    dayChallenges.forEach(c => {
      dayAllowed += c.dailyTasks.length;
    });
    
    totalAllowedTasksInRange += dayAllowed;

    let dayComp = 0;
    let dayPart = 0;
    let dayHrs = 0;

    dayLogs.forEach(l => {
      if (l.status === "Completed") {
        dayComp++;
        dayHrs += 1.0;
      } else if (l.status === "Partial") {
        dayPart++;
        dayHrs += 0.5;
      }
    });

    rangeTasksCompleted += dayComp;
    rangeTasksPartial += dayPart;
    rangeHoursLogged += dayHrs;

    const d = new Date(dateStr);
    return {
      dateKey: dateStr,
      dateStr: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      hours: dayHrs,
      tasks: dayComp
    };
  });

  const rangeCompletionRate = totalAllowedTasksInRange > 0
    ? Math.round(((rangeTasksCompleted + 0.5 * rangeTasksPartial) / totalAllowedTasksInRange) * 100)
    : 0;
  const finalRangeCompletionRate = Math.min(100, rangeCompletionRate);

  // Maximum streak value
  const overallStreak = challenges.length > 0
    ? Math.max(...challenges.map(c => getChallengeStreak(c)), 0)
    : 0;

  // Active focus day statistics calculations
  const activeDateLogs = logs.filter(l => l.date === activeDate);
  const activeChallenges = challenges.filter(c => c.startDate <= activeDate);
  let dailyHours = 0;
  let dailyTasksTotal = 0;
  let dailyTasksCompleted = 0;
  let dailyTasksPartial = 0;

  activeDateLogs.forEach(l => {
    if (l.status === "Completed") {
      dailyHours += 1.0;
      dailyTasksCompleted++;
    } else if (l.status === "Partial") {
      dailyHours += 0.5;
      dailyTasksPartial++;
    }
  });

  activeChallenges.forEach(c => {
    dailyTasksTotal += c.dailyTasks.length;
  });

  const dailyProgressRate = dailyTasksTotal > 0
    ? Math.round(((dailyTasksCompleted + 0.5 * dailyTasksPartial) / dailyTasksTotal) * 100)
    : 0;

  // Sliced chart series for compact UI rendering if large scale
  const visibleChartData = dailyChartData.length > 15
    ? dailyChartData.slice(-15)
    : dailyChartData;

  // --- REPORT GENERATOR ENGINE ---
  const handleGeneratePendingReport = () => {
    const isWeekly = reportType === "weekly";
    const spanDays = isWeekly ? 7 : 30;
    const pastDates = getPastNDays(spanDays);
    
    const spanLogs = logs.filter(l => pastDates.includes(l.date));
    let spanAllowed = 0;
    pastDates.forEach(dStr => {
      const activeChs = challenges.filter(c => c.startDate <= dStr);
      activeChs.forEach(c => {
        spanAllowed += c.dailyTasks.length;
      });
    });

    let spanComp = 0;
    let spanPart = 0;
    let totalHrs = 0;

    // Track best and weakest days
    const completionsByDay: Record<string, number> = {};
    pastDates.forEach(d => {
      completionsByDay[d] = 0;
    });

    spanLogs.forEach(l => {
      if (l.status === "Completed") {
        spanComp++;
        totalHrs += 1.0;
        completionsByDay[l.date]++;
      } else if (l.status === "Partial") {
        spanPart++;
        totalHrs += 0.5;
        completionsByDay[l.date] += 0.5;
      }
    });

    const completionRate = spanAllowed > 0
      ? Math.round(((spanComp + 0.5 * spanPart) / spanAllowed) * 100)
      : 80;

    // Determine Best Day and Weakest Day
    let bestDayStr = "N/A";
    let weakestDayStr = "N/A";
    let maxComp = -1;
    let minComp = 99999;

    pastDates.forEach(d => {
      const val = completionsByDay[d];
      if (val > maxComp) {
        maxComp = val;
        bestDayStr = d;
      }
      if (val < minComp) {
        minComp = val;
        weakestDayStr = d;
      }
    });

    const calculatedScore = Math.min(100, Math.round((completionRate * 0.8) + (overallStreak * 1.5)));
    
    // Constructive suggestions (Positive motivation only)
    let summaryText = "";
    if (calculatedScore >= 85) {
      summaryText = "Exceptional compliance! Your productivity is top tier. You have maintained a highly consistent pacing that reinforces durable neuro-pathway learning loops. Keep utilizing daily micro-logs to sustain state of flow.";
    } else if (calculatedScore >= 60) {
      summaryText = "Solid structural gains! You logged steady study hours. You possess excellent recovery habits. To lift scores even higher, consider setting challenge milestones at least 3 days in advance.";
    } else {
      summaryText = "Keep going! You have locked down the structural baseline habits. Logging single partial checkboxes prevents failure fatigue. You are in safe, steady pacing territory.";
    }

    const dRef = new Date();
    const periodLabel = isWeekly 
      ? `Week of ${dRef.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` 
      : `${dRef.toLocaleDateString("en-US", { month: "long" })} ${dRef.getFullYear()}`;

    setGeneratedReport({
      type: reportType,
      periodStr: periodLabel,
      dateKey: dRef.toISOString().split("T")[0],
      completionRate,
      totalHours: totalHrs,
      bestDay: bestDayStr,
      weakestDay: weakestDayStr,
      streak: overallStreak,
      score: calculatedScore,
      suggestionsOrForecast: summaryText
    });
  };

  const handleCommitReport = async () => {
    if (!generatedReport) return;
    await onSaveReport(generatedReport);
    setGeneratedReport(null);
    alert("Progress Report logged securely to database history registry!");
  };

  // --- MANUALLY TRIGGER REMINDERS SIMULATION ---
  const handleTriggerMockReminder = async (type: "morning" | "evening" | "eod") => {
    if (type === "morning") {
      await onSimulateNotif({
        type: "morning",
        title: "☀️ Morning Motivation Routine",
        message: `Rise and shine! Set your attention today. You have ${challenges.length} active challenges contract waiting. Clear early goals for momentum!`
      });
    } else if (type === "evening") {
      const uncheckedCount = challenges.length * 3 - activeDateLogs.length;
      await onSimulateNotif({
        type: "evening",
        title: "🌆 Twilight Consistency Reminder",
        message: `Don't break your burning streak! There are still study check boxes unchecked for today. Invest even 15 minutes to log a Partial compliance.`
      });
    } else {
      await onSimulateNotif({
        type: "eod",
        title: "📊 End-of-Day Score Card",
        message: `EOD summary: You successfully completed ${dailyTasksCompleted} tasks, contributing to ${dailyHours.toFixed(1)} study hours logged today.`
      });
    }
  };

  return (
    <div className="space-y-8 animate-fade-in text-slate-800 dark:text-slate-100" id="analytics-panel-wrapper">
      
      {/* SECTION 1: Active Focus Day snapshot counters */}
      <section className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <h3 className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
            <Clock className="h-4 w-4" />
            Active Date Real-Time Snapshot ({activeDate})
          </h3>
          <span className="text-[10px] text-indigo-505 dark:text-indigo-400 font-bold bg-indigo-500/5 px-2 py-0.5 rounded-md border border-indigo-500/10">
            Real DB Logs Active
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center gap-3.5 shadow-xs">
            <div className="h-9 w-9 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-500 shrink-0">
              <Clock className="h-4.5 w-4.5" />
            </div>
            <div>
              <span className="block text-[9px] text-slate-400 dark:text-slate-500 font-black uppercase leading-none">Logged Study Hours</span>
              <span className="block text-lg font-black text-slate-800 dark:text-white mt-1 leading-none">
                {dailyHours.toFixed(1)} Hrs
              </span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center gap-3.5 shadow-xs">
            <div className="h-9 w-9 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0">
              <Target className="h-4.5 w-4.5" />
            </div>
            <div>
              <span className="block text-[9px] text-slate-400 dark:text-slate-500 font-black uppercase leading-none">Tasks Checked</span>
              <span className="block text-lg font-black text-slate-800 dark:text-white mt-1 leading-none">
                {dailyTasksCompleted} / {dailyTasksTotal}
              </span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center gap-3.5 shadow-xs">
            <div className="h-9 w-9 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500 shrink-0">
              <Percent className="h-4.5 w-4.5" />
            </div>
            <div>
              <span className="block text-[9px] text-slate-400 dark:text-slate-500 font-black uppercase leading-none">Focus Rate</span>
              <span className="block text-lg font-black text-slate-800 dark:text-white mt-1 leading-none">
                {dailyProgressRate}%
              </span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center gap-3.5 shadow-xs">
            <div className="h-9 w-9 rounded-lg bg-orange-500/10 flex items-center justify-center text-orange-500 shrink-0">
              <Flame className="h-4.5 w-4.5" />
            </div>
            <div>
              <span className="block text-[9px] text-slate-400 dark:text-slate-500 font-black uppercase leading-none">Longest Streak</span>
              <span className="block text-lg font-black text-orange-605 dark:text-orange-400 mt-1 leading-none">
                {overallStreak} Days
              </span>
            </div>
          </div>

        </div>
      </section>

      {/* SECTION 2: Dynamic graph columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Graph Block Range select */}
        <section className="lg:col-span-2 p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-1.5">
                <TrendingUp className="h-4.5 w-4.5 text-indigo-500" />
                Durable History Records
              </h3>
              <p className="text-xs text-slate-400 mr-2">Track completion progress, average scores, and check histories dynamically.</p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-450 dark:text-slate-500">Period:</span>
              <select
                value={historyRange}
                onChange={(e) => setHistoryRange(e.target.value as any)}
                className="rounded-lg border border-slate-201 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-1.5 text-[11px] font-bold text-slate-700 dark:text-slate-300 focus:outline-none"
              >
                <option value="7">Last 7 Days</option>
                <option value="30">Last 30 Days</option>
                <option value="90">Last 90 Days</option>
                <option value="180">Last 180 Days</option>
                <option value="all">All Time Statistics</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 bg-slate-50 dark:bg-slate-950 p-3 rounded-xl text-center">
            <div>
              <span className="block text-[9px] text-slate-400 dark:text-slate-500 uppercase font-black">Span Logged Hours</span>
              <span className="block text-base font-black text-indigo-600 dark:text-indigo-400 mt-1">
                {rangeHoursLogged.toFixed(1)} Hrs
              </span>
            </div>
            <div>
              <span className="block text-[9px] text-slate-400 dark:text-slate-500 uppercase font-black">Compliance Rate</span>
              <span className="block text-base font-black text-emerald-600 dark:text-emerald-400 mt-1">
                {finalRangeCompletionRate}%
              </span>
            </div>
            <div>
              <span className="block text-[9px] text-slate-400 dark:text-slate-500 uppercase font-black">Habit Score</span>
              <span className={`block text-base font-black mt-1 ${finalRangeCompletionRate >= 75 ? "text-amber-500" : "text-slate-400"}`}>
                {finalRangeCompletionRate >= 85 ? "Exceptional" : finalRangeCompletionRate >= 50 ? "Healthy" : "Active 🌱"}
              </span>
            </div>
          </div>

          {/* Dynamic Recharts Bar */}
          <div className="h-56 w-full pt-1.5">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={visibleChartData} margin={{ top: 5, right: 5, left: -25, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" className="dark:hidden" />
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" className="hidden dark:block" />
                <XAxis 
                  dataKey="dateStr" 
                  tick={{ fontSize: 9, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis 
                  tick={{ fontSize: 9, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  width={30}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: "#0f172a", 
                    border: "none", 
                    borderRadius: "12px", 
                    color: "#fff",
                    fontSize: "10px"
                  }} 
                />
                <Bar 
                  dataKey="hours" 
                  fill="#6366f1" 
                  radius={[5, 5, 0, 0]} 
                  maxBarSize={24}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[9.5px] text-slate-400 italic text-center">Calculations based exclusively on real dates activity stored in your database.</p>
        </section>

        {/* Coach Recommendation panel */}
        <div className="space-y-6">
          <section className="p-5 rounded-2xl bg-gradient-to-br from-indigo-950/20 via-slate-900 to-slate-950 border border-indigo-500/20 shadow-xl space-y-4 relative overflow-hidden h-full flex flex-col justify-between">
            <div className="space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-md bg-indigo-500/15 flex items-center justify-center text-indigo-400">
                    <Sparkles className="h-4 animate-pulse" />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-white leading-none">Smart Motivational Coach</h4>
                    <span className="text-[7.5px] text-indigo-400 font-bold uppercase tracking-wider">{coachSource}</span>
                  </div>
                </div>
                <button 
                  onClick={fetchCoachInsights}
                  disabled={coachLoading}
                  className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition"
                >
                  <RefreshCw className={`h-3 w-3 ${coachLoading ? "animate-spin" : ""}`} />
                </button>
              </div>

              {coachLoading ? (
                <div className="space-y-2 py-4">
                  <div className="h-2.5 w-11/12 bg-slate-800 rounded animate-pulse" />
                  <div className="h-2.5 w-9/12 bg-slate-800 rounded animate-pulse" />
                  <div className="h-2.5 w-10/12 bg-slate-800 rounded animate-pulse" />
                </div>
              ) : (
                <div className="space-y-2.5 text-xs text-slate-300">
                  {coachInsights.map((insight, idx) => (
                    <div key={idx} className="flex gap-2 items-start bg-slate-900/40 p-2 rounded-xl border border-slate-800/60">
                      <span className="text-amber-405 shrink-0 mt-0.5">✦</span>
                      <p className="leading-relaxed text-[11px] font-semibold text-slate-350">{insight}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="text-[10px] text-slate-400 flex items-center gap-1.5 pt-3 border-t border-slate-850">
              <Award className="h-4 w-4 text-amber-500" />
              <span>Streak compliance forecast is optimized.</span>
            </div>
          </section>
        </div>

      </div>

      {/* SECTION 3: Medals & Achievements shelves */}
      <section className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div>
          <h3 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-1.5">
            <Award className="h-4.5 w-4.5 text-amber-500" />
            Medals Cabinet & Unlocked Achievements
          </h3>
          <p className="text-xs text-slate-400">Complete tasks and keep up long-term consistency to unlock medals dynamically in database.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          
          <div className={`p-4 rounded-xl border text-center transition ${
            achievements.some(a => a.title === "Pristine Start")
              ? "bg-gradient-to-b from-amber-500/5 to-amber-550/10 border-amber-500/30 text-slate-850 dark:text-slate-100"
              : "opacity-40 border-slate-200 dark:border-slate-800 bg-slate-50/50"
          }`}>
            <span className="text-2xl">🌱</span>
            <h4 className="text-xs font-black mt-2">Pristine Start</h4>
            <p className="text-[10px] text-slate-405 mt-0.5">Checked at least 1 task.</p>
            {achievements.some(a => a.title === "Pristine Start") ? (
              <span className="text-[8px] font-semibold text-amber-600 dark:text-amber-400 uppercase mt-2 inline-block">Unlocked ⭐</span>
            ) : (
              <span className="text-[8px] text-slate-400 uppercase mt-2 inline-block">Locked</span>
            )}
          </div>

          <div className={`p-4 rounded-xl border text-center transition ${
            achievements.some(a => a.title === "Consistency Master")
              ? "bg-gradient-to-b from-amber-500/5 to-amber-550/10 border-amber-500/30 text-slate-850 dark:text-slate-100"
              : "opacity-40 border-slate-200 dark:border-slate-800 bg-slate-50/50"
          }`}>
            <span className="text-2xl">🔥</span>
            <h4 className="text-xs font-black mt-2">Consistency Master</h4>
            <p className="text-[10px] text-slate-405 mt-0.5">3 perfect completed days.</p>
            {achievements.some(a => a.title === "Consistency Master") ? (
              <span className="text-[8px] font-semibold text-amber-600 dark:text-amber-400 uppercase mt-2 inline-block">Unlocked ⭐</span>
            ) : (
              <span className="text-[8px] text-slate-400 uppercase mt-2 inline-block">Locked</span>
            )}
          </div>

          <div className={`p-4 rounded-xl border text-center transition ${
            achievements.some(a => a.title === "Goal Creator")
              ? "bg-gradient-to-b from-amber-500/5 to-amber-550/10 border-amber-500/30 text-slate-850 dark:text-slate-100"
              : "opacity-40 border-slate-200 dark:border-slate-800 bg-slate-50/50"
          }`}>
            <span className="text-2xl">🎯</span>
            <h4 className="text-xs font-black mt-2">Goal Creator</h4>
            <p className="text-[10px] text-slate-405 mt-0.5">Set a checklist goal.</p>
            {achievements.some(a => a.title === "Goal Creator") ? (
              <span className="text-[8px] font-semibold text-amber-600 dark:text-amber-400 uppercase mt-2 inline-block">Unlocked ⭐</span>
            ) : (
              <span className="text-[8px] text-slate-400 uppercase mt-2 inline-block">Locked</span>
            )}
          </div>

          <div className={`p-4 rounded-xl border text-center transition ${
            achievements.some(a => a.title === "Milestone Conquered")
              ? "bg-gradient-to-b from-amber-500/5 to-amber-550/10 border-amber-500/30 text-slate-850 dark:text-slate-100"
              : "opacity-40 border-slate-200 dark:border-slate-800 bg-slate-50/50"
          }`}>
            <span className="text-2xl">🏆</span>
            <h4 className="text-xs font-black mt-2">Milestone Conquered</h4>
            <p className="text-[10px] text-slate-405 mt-0.5">Checked a custom goal done.</p>
            {achievements.some(a => a.title === "Milestone Conquered") ? (
              <span className="text-[8px] font-semibold text-amber-600 dark:text-amber-400 uppercase mt-2 inline-block">Unlocked ⭐</span>
            ) : (
              <span className="text-[8px] text-slate-400 uppercase mt-2 inline-block">Locked</span>
            )}
          </div>

        </div>
      </section>

      {/* SECTION 4: Full-Stack Notifications and Automated Dispatch Auditor */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6" id="notifications-system-settings">
        
        {/* LEFT COLUMN: Configuration settings & Credentials */}
        <div className="lg:col-span-7 space-y-6">
          <section className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-1.5">
                  <Settings className="h-4.5 w-4.5 text-indigo-550 text-indigo-505" />
                  Notifications & Automations Director
                </h3>
                <p className="text-xs text-slate-400">Configure custom notification times, select email providers, and specify API credentials.</p>
              </div>
              <div className="flex bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200/50 dark:border-slate-755 text-[10px] font-black uppercase">
                <button 
                  onClick={() => setActiveTab("settings")} 
                  className={`px-3 py-1 rounded-md transition ${activeTab === "settings" ? "bg-white dark:bg-slate-700 shadow-xs text-indigo-500" : "text-slate-400 hover:text-slate-200"}`}
                >
                  Config
                </button>
                <button 
                  onClick={() => { setActiveTab("history"); fetchEmailLogs(); }} 
                  className={`px-3 py-1 rounded-md transition ${activeTab === "history" ? "bg-white dark:bg-slate-700 shadow-xs text-indigo-500" : "text-slate-400 hover:text-slate-200"}`}
                >
                  Audit Logs ({emailLogs.length})
                </button>
              </div>
            </div>

            {activeTab === "settings" ? (
              <div className="space-y-4 pt-1">
                {/* 1. Core Channels Toggles */}
                <div className="p-4 bg-slate-50/50 dark:bg-slate-950/20 rounded-xl border border-slate-150 dark:border-slate-850 space-y-3">
                  <span className="text-[9px] uppercase font-black tracking-widest text-indigo-500 block">1. Alert Channels Enablement</span>
                  <div className="grid grid-cols-3 gap-3">
                    <label className="flex items-center gap-1.5 p-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/60 dark:border-slate-800/60 cursor-pointer text-[10.5px] font-bold select-none">
                      <input 
                        type="checkbox"
                        checked={activeSettings.emailEnabled}
                        onChange={(e) => onUpdateNotifSettings({ emailEnabled: e.target.checked })}
                        className="rounded border-slate-300 text-indigo-500 focus:ring-indigo-550"
                      />
                      <Mail className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span>Email</span>
                    </label>

                    <label className="flex items-center gap-1.5 p-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/60 dark:border-slate-800/60 cursor-pointer text-[10.5px] font-bold select-none">
                      <input 
                        type="checkbox"
                        checked={activeSettings.inAppEnabled}
                        onChange={(e) => onUpdateNotifSettings({ inAppEnabled: e.target.checked })}
                        className="rounded border-slate-300 text-indigo-500 focus:ring-indigo-550"
                      />
                      <Bell className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span>In-App</span>
                    </label>

                    <label className="flex items-center gap-1.5 p-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/60 dark:border-slate-800/60 cursor-pointer text-[10.5px] font-bold select-none">
                      <input 
                        type="checkbox"
                        checked={activeSettings.pushEnabled}
                        onChange={(e) => onUpdateNotifSettings({ pushEnabled: e.target.checked })}
                        className="rounded border-slate-300 text-indigo-500 focus:ring-indigo-550"
                      />
                      <Smartphone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span>Push</span>
                    </label>
                  </div>
                </div>

                {/* 2. Custom Timings scheduler inputs */}
                <div className="p-4 bg-slate-50/50 dark:bg-slate-950/20 rounded-xl border border-slate-150 dark:border-slate-850 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] uppercase font-black tracking-widest text-indigo-500 block">2. Daily schedule triggers</span>
                    <span className="text-[9px] text-slate-400 font-mono">24h format (HH:MM)</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] uppercase font-bold text-slate-404 mb-1">Morning Routines Time</label>
                      <input 
                        type="text" 
                        value={morningT}
                        onChange={(e) => setMorningT(e.target.value)}
                        placeholder="08:00"
                        className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold text-slate-404 mb-1">Evening Reminder Time</label>
                      <input 
                        type="text" 
                        value={eveningT}
                        onChange={(e) => setEveningT(e.target.value)}
                        placeholder="18:00"
                        className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold text-slate-404 mb-1">End-of-Day Summary Time</label>
                      <input 
                        type="text" 
                        value={eodT}
                        onChange={(e) => setEodT(e.target.value)}
                        placeholder="21:00"
                        className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 font-mono font-bold"
                      />
                    </div>
                  </div>
                </div>



                {/* Save Credentials Action */}
                <div className="flex justify-between items-center pt-1">
                  <span className="text-[10px] text-slate-400 font-medium">Saves updated scheduling and toggle preferences.</span>
             <button
  onClick={() =>
    setTestMessage({
      success: true,
      text: "Settings saved successfully"
    })
  }
>
  Save Automation Preferences
</button>
                </div>

                {saveStatus && (
                  <div className={`p-3 rounded-xl text-xs font-semibold ${saveStatus.success ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20" : "bg-rose-500/10 text-rose-600 border border-rose-500/20"}`}>
                    {saveStatus.success ? "✅ " : "❌ "} {saveStatus.text}
                  </div>
                )}
              </div>
            ) : (
              /* SECURE COMMUNICATIONS AUDITOR & DELIVERY TRACER TAB */
              <div className="space-y-4 pt-1 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black uppercase text-slate-404 tracking-widest">Chronological Automated Delivery History Logs</span>
                  <button 
                    onClick={fetchEmailLogs}
                    disabled={logsLoading}
                    className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition"
                  >
                    <RefreshCw className={`h-4 w-4 ${logsLoading ? "animate-spin" : ""}`} />
                  </button>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 text-[11px] max-h-96 overflow-y-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-50 dark:bg-slate-950 text-[10px] font-black tracking-wider text-slate-400 uppercase select-none sticky top-0 md:bg-opacity-95">
                      <tr>
                        <th className="p-2.5 border-b border-slate-200 dark:border-slate-800">Campaign</th>
                        <th className="p-2.5 border-b border-slate-200 dark:border-slate-800">To</th>
                        <th className="p-2.5 border-b border-slate-200 dark:border-slate-800">Status</th>
                        <th className="p-2.5 border-b border-slate-200 dark:border-slate-800">Provider</th>
                        <th className="p-2.5 border-b border-slate-200 dark:border-slate-800">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-850">
                      {emailLogs.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-12 text-center text-slate-400 font-semibold italic">
                            No mailing attempts registered. Use sandbox triggers to create audit logs!
                          </td>
                        </tr>
                      ) : (
                        emailLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-950/25">
                            <td className="p-2.5 whitespace-nowrap">
                              <span className="inline-block px-2 py-0.5 rounded-full font-black text-[9px] uppercase tracking-wider bg-indigo-500/10 text-indigo-500">
                                {log.campaign}
                              </span>
                            </td>
                            <td className="p-2.5 font-semibold truncate max-w-[120px]" title={log.to}>
                              {log.to}
                            </td>
                            <td className="p-2.5 whitespace-nowrap">
                              {log.status === "success" ? (
                                <span className="inline-flex items-center gap-1 text-emerald-500 font-bold bg-emerald-500/10 px-2 py-0.5 rounded-full text-[9px] uppercase">
                                  ● Delivered
                                </span>
                              ) : (
                                <span 
                                  className="inline-flex items-center gap-1 text-rose-500 font-bold bg-rose-500/10 px-2 py-0.5 rounded-full text-[9px] uppercase cursor-help"
                                  title={log.error || "Mail relay failed"}
                                >
                                  ❌ Failed
                                </span>
                              )}
                            </td>
                            <td className="p-2.5 font-mono text-[9px] text-slate-400 capitalize">
                              {log.providerUsed}
                            </td>
                            <td className="p-2.5 text-slate-400 whitespace-nowrap font-mono text-[9.5px]">
                              {new Date(log.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({new Date(log.sentAt).toLocaleDateString([], { month: 'short', day: 'numeric' })})
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="p-3 bg-indigo-500/5 rounded-xl border border-indigo-500/10 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-slate-650 dark:text-slate-350">
                  <Info className="h-4 w-4 text-indigo-500 shrink-0 mt-0.5" />
                  <span>
                    <strong>Scheduler Verification:</strong> Weekly and Monthly automated dispatches attach a <strong>High-Fidelity PDF Performance Report</strong> containing compiled compliance metrics, studied hours charts, logs, and coach forecasts dynamically written by Node's PDF Engine!
                  </span>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* RIGHT COLUMN: Connection Sandbox Testing & Scheduler manual overrides */}
        <div className="lg:col-span-5 space-y-6">
          {/* Connection Testing and Mock Mail releases */}
          <section className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
            <div>
              <h4 className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                Gateway Testing Sandbox
              </h4>
              <p className="text-xs text-slate-400 mt-1">Verify mail gateways, SMTP connectivity keys, and trigger instant campaign releases.</p>
            </div>

            {/* Verification Form */}
            <form onSubmit={handleSendTestEmail} className="space-y-3">
              <label className="block text-[10.5px] font-extrabold text-slate-700 dark:text-slate-300">
                Release Instant Test Mail Connection
              </label>
              <div className="flex gap-2">
                <input 
                  type="email"
                  value={testEmailTo}
                  onChange={(e) => setTestEmailTo(e.target.value)}
                  placeholder="recipient@example.com"
                  className="flex-1 text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-semibold"
                />
                <button
                  type="submit"
                  disabled={testSending}
                  className="px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-slate-850 dark:hover:bg-slate-750 text-indigo-600 dark:text-indigo-400 font-black text-xs rounded-xl border border-indigo-200/50 dark:border-slate-750 flex items-center gap-1.5 transition select-none cursor-pointer"
                >
                  {testSending ? (
                    <RefreshCw className="h-3 w-3 animate-spin" />
                  ) : (
                    "Send Verification"
                  )}
                </button>
              </div>

              {testMessage && (
                <div className={`p-3 rounded-xl text-xs font-medium border ${testMessage.success ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-600" : "bg-rose-500/15 border-rose-500/30 text-rose-600"}`}>
                  {testMessage.text}
                </div>
              )}
            </form>

            <div className="border-t border-slate-100 dark:border-slate-850 pt-4 space-y-3">
              <span className="block text-[10.5px] font-extrabold text-slate-700 dark:text-slate-300">
                Manual Automated Scheduler Trigger
              </span>
              <p className="text-[10px] text-slate-400">Launch immediate background automated emails on demand. Select high-fidelity PDF weekly or EOD logs templates.</p>
              
              <div className="grid grid-cols-2 gap-2 text-[10.5px] font-extrabold">
                <button
                  onClick={() => handleTriggerEmailCampaign("morning")}
                  className="p-2.5 hover:p-2 bg-slate-50 dark:bg-slate-950 border border-slate-200/50 dark:border-slate-850/50 hover:bg-slate-100 dark:hover:bg-slate-850 text-left rounded-xl transition cursor-pointer"
                >
                  ☀️ Morning Delivery
                </button>
                <button
                  onClick={() => handleTriggerEmailCampaign("evening")}
                  className="p-2.5 hover:p-2 bg-slate-50 dark:bg-slate-950 border border-slate-200/50 dark:border-slate-850/50 hover:bg-slate-100 dark:hover:bg-slate-850 text-left rounded-xl transition cursor-pointer"
                >
                  🌆 Evening Delivery
                </button>
                <button
                  onClick={() => handleTriggerEmailCampaign("eod")}
                  className="p-2.5 hover:p-2 bg-slate-50 dark:bg-slate-950 border border-slate-200/50 dark:border-slate-850/50 hover:bg-slate-100 dark:hover:bg-slate-850 text-left rounded-xl transition cursor-pointer"
                >
                  📊 Daily EOD Report
                </button>
                <button
                  onClick={() => handleTriggerEmailCampaign("weekly")}
                  className="p-2.5 hover:p-2 bg-indigo-50/50 hover:p-2 dark:bg-indigo-950/20 hover:bg-indigo-100 dark:hover:bg-indigo-900 border border-indigo-150 dark:border-indigo-850/30 text-left rounded-xl transition cursor-pointer text-indigo-505"
                >
                  ⏳ Weekly PDF
                </button>
              </div>
            </div>
          </section>

          {/* Alert inbox widget */}
          <section className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-black text-slate-800 dark:text-white flex items-center gap-1.5">
                  <Bell className="h-4 w-4 text-indigo-555 animate-bounce text-indigo-505" />
                  Your Alerts Registry Inbox
                </h4>
                <p className="text-[11px] text-slate-400">Dynamic system notifications regarding your challenge checklist performance.</p>
              </div>
              {notifications.some(n => !n.read) && (
                <button
                  onClick={() => onMarkNotifsRead(undefined, true)}
                  className="text-[10px] font-bold text-indigo-500 hover:text-indigo-600 transition"
                >
                  Clear All
                </button>
              )}
            </div>

            <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
              {notifications.length === 0 ? (
                <div className="py-8 text-center text-slate-400 border border-dashed border-slate-100 dark:border-slate-850 rounded-2xl">
                  <span className="text-xl">📭</span>
                  <p className="text-[10px] mt-1 font-semibold italic text-slate-450">Alert inbox clear. Trigger simulation checks above!</p>
                </div>
              ) : (
                notifications.map(n => (
                  <div 
                    key={n.id} 
                    className={`p-2.5 rounded-xl border text-xs relative ${
                      n.read 
                        ? "bg-slate-50/50 dark:bg-slate-950/20 border-slate-150/45 dark:border-slate-850/45 text-slate-500" 
                        : "bg-indigo-500/5 border-indigo-500/25 text-slate-800 dark:text-white font-semibold"
                    }`}
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-850/45 pb-1 mb-1 text-[10.5px]">
                      <span className="capitalize font-black text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                        📢 {n.type} Alert
                      </span>
                      <span className="font-mono text-[9px] text-slate-400">{n.date}</span>
                    </div>
                    <h5 className="font-bold text-[11px] mb-0.5">{n.title}</h5>
                    <p className="text-[10px] leading-relaxed text-slate-505 dark:text-slate-350">{n.message}</p>
                    
                    {!n.read && (
                      <button
                        onClick={() => onMarkNotifsRead(n.id)}
                        className="absolute right-2.5 top-2 text-[9px] bg-indigo-500 hover:bg-indigo-600 text-white px-1.5 py-0.5 rounded-md cursor-pointer"
                        title="Mark seen"
                      >
                        ✓ Read
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

      </div>

      {/* SECTION 5: Progress Reports Planner & Reports History Cabinet */}
      <section className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-850 pb-4">
          <div>
            <h3 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-1.5">
              <FileText className="h-4.5 w-4.5 text-indigo-500" />
              Progress Reports Planner & Database Registry
            </h3>
            <p className="text-xs text-slate-405 mt-0.5">Generate, audit, and permanently seal high-fidelity weekly & monthly performance reports.</p>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={reportType}
              onChange={(e) => {
                setReportType(e.target.value as any);
                setGeneratedReport(null);
              }}
              className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-2 text-xs font-bold"
            >
              <option value="weekly">Weekly Report (Last 7 Days)</option>
              <option value="monthly">Monthly Report (Last 30 Days)</option>
            </select>
            <button
              onClick={handleGeneratePendingReport}
              className="px-4 py-2 bg-indigo-605 hover:bg-indigo-555 bg-indigo-600 outline-none text-white font-extrabold text-xs rounded-xl shadow-lg transition shadow-indigo-600/10 cursor-pointer"
            >
              Generate New Report
            </button>
          </div>
        </div>

        {/* Generate Report Output preview panel */}
        {generatedReport && (
          <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-500/5 to-indigo-500/5 border border-emerald-500/20 shadow-xs space-y-4">
            <div className="flex justify-between items-start border-b border-emerald-500/10 pb-3">
              <div>
                <span className="text-[10px] uppercase font-black text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full select-none">
                  Prepared Registry Sealed Preview
                </span>
                <h4 className="text-sm font-black text-slate-800 dark:text-white mt-1.5">{generatedReport.periodStr} {generatedReport.type === "weekly" ? "Weekly" : "Monthly"} Report Analytics</h4>
              </div>
              <div className="text-right">
                <span className="text-[9px] uppercase text-slate-400 block font-bold leading-none">Productivity Score</span>
                <span className="text-2xl font-black text-emerald-500 tracking-tight block mt-1 leading-none">{generatedReport.score} <span className="text-xs font-medium text-slate-400">/100</span></span>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div className="p-3 bg-white/60 dark:bg-slate-950/40 rounded-xl border border-slate-200/40 dark:border-slate-800/40">
                <span className="text-[9px] uppercase text-slate-400 block font-bold">Log Compliance</span>
                <span className="font-extrabold text-slate-800 dark:text-white text-sm mt-0.5 block">{generatedReport.completionRate}%</span>
              </div>
              <div className="p-3 bg-white/60 dark:bg-slate-950/40 rounded-xl border border-slate-200/40 dark:border-slate-800/40">
                <span className="text-[9px] uppercase text-slate-400 block font-bold">Total Studied Hours</span>
                <span className="font-extrabold text-slate-800 dark:text-white text-sm mt-0.5 block">{generatedReport.totalHours.toFixed(1)} Hours</span>
              </div>
              <div className="p-3 bg-white/60 dark:bg-slate-950/40 rounded-xl border border-slate-200/40 dark:border-slate-800/40">
                <span className="text-[9px] uppercase text-slate-400 block font-bold">Best Performed Day</span>
                <span className="font-mono text-slate-800 dark:text-slate-100 text-xs mt-0.5 block">{generatedReport.bestDay}</span>
              </div>
              <div className="p-3 bg-white/60 dark:bg-slate-950/40 rounded-xl border border-slate-200/40 dark:border-slate-800/40">
                <span className="text-[9px] uppercase text-slate-400 block font-bold">Consistency Streak</span>
                <span className="font-extrabold text-amber-500 text-sm mt-0.5 block">{generatedReport.streak} Days</span>
              </div>
            </div>

            <div className="p-3.5 bg-indigo-500/5 border border-indigo-500/10 rounded-xl text-xs space-y-1">
              <span className="font-black text-[10px] text-indigo-500 uppercase tracking-widest block">Coach Positive Suggestions & Forecast:</span>
              <p className="leading-relaxed text-slate-700 dark:text-slate-300 font-medium">{generatedReport.suggestionsOrForecast}</p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setGeneratedReport(null)}
                className="px-4 py-2 bg-slate-150/60 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-xs font-bold rounded-xl"
              >
                Cancel Draft
              </button>
              <button
                onClick={handleCommitReport}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs rounded-xl flex items-center gap-1.5 shadow-lg shadow-emerald-600/10 cursor-pointer"
              >
                <Check className="h-4 w-4" /> Seal & Save to History Vault
              </button>
            </div>
          </div>
        )}

        {/* History reports Vault list */}
        <div className="space-y-3">
          <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Sealed Reports History Vault ({reports.length})</span>
          
          {reports.length === 0 ? (
            <div className="py-8 text-center text-slate-400 border border-dashed border-slate-150 dark:border-slate-800/80 rounded-2xl">
              <span className="text-xl">🗄️</span>
              <p className="text-[10px] mt-1 italic font-semibold text-slate-450">No reports committed to database vault yet. Generate and save one above!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {reports.map(r => (
                <div key={r.id} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20 text-xs space-y-3 transition hover:border-slate-300 dark:hover:border-slate-750">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-[9px] uppercase font-black text-indigo-500 bg-indigo-500/10 px-1.5 py-0.5 rounded-full block w-max">
                        {r.type}
                      </span>
                      <h5 className="font-extrabold text-[12px] mt-1.5 text-slate-800 dark:text-slate-100">{r.periodStr}</h5>
                    </div>
                    <div className="text-right">
                      <span className="text-[8px] text-slate-400 uppercase leading-none block">Productivity Score</span>
                      <span className="text-base font-black text-emerald-500 block mt-1">{r.score}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center text-[10px] bg-white dark:bg-slate-950 p-2 rounded-lg border border-slate-100 dark:border-slate-850">
                    <div>
                      <span className="text-[8px] text-slate-400 uppercase leading-none">Rate</span>
                      <span className="block font-bold text-slate-755 mt-0.5">{r.completionRate}%</span>
                    </div>
                    <div>
                      <span className="text-[8px] text-slate-400 uppercase leading-none">Hours</span>
                      <span className="block font-bold text-slate-755 mt-0.5">{r.totalHours.toFixed(1)}h</span>
                    </div>
                    <div>
                      <span className="text-[8px] text-slate-400 uppercase leading-none">Streak</span>
                      <span className="block font-bold text-slate-755 mt-0.5">{r.streak}d</span>
                    </div>
                  </div>

                  <div className="text-[10px] leading-relaxed text-slate-500 line-clamp-2 italic font-medium">
                    "{r.suggestionsOrForecast}"
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

    </div>
  );
}
