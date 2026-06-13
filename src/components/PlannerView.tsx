import React, { useState } from "react";
import { 
  Plus, Trash2, Calendar, Check, AlertCircle, X, ChevronLeft, ChevronRight, 
  Flame, CalendarDays, Percent, Clock, Sparkles, Smile, ListChecks, HelpCircle
} from "lucide-react";
import { Challenge, ChallengeDailyLog, UserNote, UserGoal } from "../types";

interface PlannerViewProps {
  challenges: Challenge[];
  logs: ChallengeDailyLog[];
  activeDate: string; // YYYY-MM-DD
  setActiveDate: (date: string) => void;
  onAddChallenge: (challenge: {
    name: string;
    startDate: string;
    durationDays: number;
    dailyTasks: string[];
  }) => Promise<void>;
  onUpdateLogStatus: (
    challengeId: string, 
    date: string, 
    taskTitle: string, 
    status: "Completed" | "Skipped" | "Partial" | "Uncompleted"
  ) => Promise<void>;
  onDeleteChallenge: (id: string) => Promise<void>;
  notes: UserNote[];
  goals: UserGoal[];
  onSaveNote: (challengeId: string | undefined, date: string, content: string) => Promise<void>;
  onCreateGoal: (title: string, targetDate: string, challengeId?: string) => Promise<void>;
  onToggleGoal: (id: string, completed: boolean) => Promise<void>;
  onDeleteGoal: (id: string) => Promise<void>;
}

export default function PlannerView({
  challenges,
  logs,
  activeDate,
  setActiveDate,
  onAddChallenge,
  onUpdateLogStatus,
  onDeleteChallenge,
  notes,
  goals,
  onSaveNote,
  onCreateGoal,
  onToggleGoal,
  onDeleteGoal
}: PlannerViewProps) {
  // Navigation & Drawer
  const [isAddingChallenge, setIsAddingChallenge] = useState(false);
  const [newChallengeName, setNewChallengeName] = useState("");
  const [newDurationType, setNewDurationType] = useState<string>("30");
  const [customDaysValue, setCustomDaysValue] = useState("");
  const [taskInputs, setTaskInputs] = useState<string[]>([""]); // starts with one task input slot
  const [formError, setFormError] = useState<string | null>(null);

  // shift date back/forth
  const shiftDate = (days: number) => {
    const d = new Date(activeDate);
    d.setDate(d.getDate() + days);
    setActiveDate(d.toISOString().split("T")[0]);
  };

  const handleSetToday = () => {
    setActiveDate(new Date().toISOString().split("T")[0]);
  };

  // Stats calculation helper
  const getChallengeStats = (c: Challenge, targetDate: string) => {
    const start = new Date(c.startDate);
    start.setHours(0,0,0,0);
    const target = new Date(targetDate);
    target.setHours(0,0,0,0);
    
    const diffTime = target.getTime() - start.getTime();
    const diffDays = Math.floor(diffTime / (24 * 60 * 60 * 1000));
    
    let daysElapsed = diffDays + 1;
    let status: "Not Started" | "Active" | "Finished" = "Active";
    
    if (daysElapsed <= 0) {
      daysElapsed = 0;
      status = "Not Started";
    } else if (daysElapsed > c.durationDays) {
      daysElapsed = c.durationDays;
      status = "Finished";
    }
    
    const daysRemaining = c.durationDays - daysElapsed;
    const challengeLogs = logs.filter(l => l.challengeId === c.id);
    
    // Days completed: Days in elapsed range with >=1 Successful mark
    const successfulDates = new Set(
      challengeLogs
        .filter(l => l.status === "Completed" || l.status === "Partial")
        .map(l => l.date)
    );
    const daysCompleted = successfulDates.size;
    
    // Score so far: Completed = 1.0, Partial = 0.5
    let points = 0;
    challengeLogs.forEach(l => {
      if (l.date <= targetDate) {
        if (l.status === "Completed") points += 1.0;
        else if (l.status === "Partial") points += 0.5;
      }
    });

    const totalPossibleTasks = daysElapsed * c.dailyTasks.length;
    const completionPercentage = totalPossibleTasks > 0 
      ? Math.round((points / totalPossibleTasks) * 100) 
      : 0;

    // Current streak up to targetDate (yesterday or today)
    let currentStreak = 0;
    const hasSuccess = (dStr: string) => {
      const dateLogs = challengeLogs.filter(l => l.date === dStr);
      return dateLogs.some(l => l.status === "Completed" || l.status === "Partial");
    };

    const todayStr = target.toISOString().split("T")[0];
    const yester = new Date(target);
    yester.setDate(yester.getDate() - 1);
    const yesterStr = yester.toISOString().split("T")[0];

    const startFromToday = hasSuccess(todayStr);
    const startFromYesterday = hasSuccess(yesterStr);

    if (startFromToday || startFromYesterday) {
      let curr = startFromToday ? new Date(target) : yester;
      while (true) {
        const currStr = curr.toISOString().split("T")[0];
        if (currStr < c.startDate) break;
        
        if (hasSuccess(currStr)) {
          currentStreak++;
          curr.setDate(curr.getDate() - 1);
        } else {
          break;
        }
      }
    }

    return {
      daysCompleted,
      daysRemaining,
      daysElapsed,
      completionPercentage,
      currentStreak,
      status
    };
  };

  // Filter challenges active on the selected date
  const challengesOnSelectedDate = challenges.filter(c => c.startDate <= activeDate);

  // Form Task functions
  const handleAddTaskField = () => {
    setTaskInputs([...taskInputs, ""]);
  };

  const handleRemoveTaskField = (index: number) => {
    if (taskInputs.length === 1) return;
    setTaskInputs(taskInputs.filter((_, idx) => idx !== index));
  };

  const handleTaskInputChange = (index: number, val: string) => {
    const updated = [...taskInputs];
    updated[index] = val;
    setTaskInputs(updated);
  };

  // Submit Challenge Addition
  const handleCreateChallengeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    
    if (!newChallengeName.trim()) {
      setFormError("Challenge name is required");
      return;
    }

    const duration = newDurationType === "custom" 
      ? Number(customDaysValue) 
      : Number(newDurationType);

    if (!duration || duration <= 0) {
      setFormError("Please enter a valid challenge duration in days.");
      return;
    }

    const cleanedTasks = taskInputs.map(t => t.trim()).filter(Boolean);
    if (cleanedTasks.length === 0) {
      setFormError("Please provide at least one recurring daily task.");
      return;
    }

    try {
      await onAddChallenge({
        name: newChallengeName.trim(),
        startDate: activeDate, // starts today on the active navigator
        durationDays: duration,
        dailyTasks: cleanedTasks
      });
      // reset
      setNewChallengeName("");
      setNewDurationType("30");
      setCustomDaysValue("");
      setTaskInputs([""]);
      setIsAddingChallenge(false);
    } catch (err: any) {
      setFormError(err.message || "Failed to create challenge.");
    }
  };

  return (
    <div className="space-y-8" id="challenges-panel">
      
      {/* Dynamic Date Navigator */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => shiftDate(-1)}
            className="p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white transition"
            title="Preceding Day"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          
          <div className="flex flex-col">
            <span className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Active Focus Date</span>
            <span className="text-sm font-black text-slate-850 dark:text-white flex items-center gap-2">
              <Calendar className="h-4 w-4 text-indigo-505 text-indigo-500" />
              {new Date(activeDate).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })}
            </span>
          </div>

          <button
            onClick={() => shiftDate(1)}
            className="p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white transition"
            title="Succeeding Day"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSetToday}
            className="px-4 py-2 rounded-xl border border-slate-201 dark:border-slate-800 text-xs font-extrabold bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300 hover:border-indigo-500 transition cursor-pointer"
          >
            Go Today
          </button>
          <input
            type="date"
            value={activeDate}
            onChange={(e) => e.target.value && setActiveDate(e.target.value)}
            className="p-1.5 rounded-xl border border-slate-201 dark:border-slate-800 text-xs font-bold bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* active challenges grid display */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2">
              🔥 Active Challenges
            </h2>
            <p className="text-xs text-slate-450 dark:text-slate-400">Your registered challenges tracking habits, completion rates, and daily streaks.</p>
          </div>
          
          <button
            onClick={() => {
              setIsAddingChallenge(true);
              setFormError(null);
            }}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition shadow-lg shadow-indigo-600/15 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Create Challenge
          </button>
        </div>

        {challenges.length === 0 ? (
          /* Empty challenges placeholder */
          <div className="text-center p-10 rounded-2xl bg-white dark:bg-slate-900 border border-dashed border-slate-200 dark:border-slate-800">
            <span className="text-3xl">🚀</span>
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-250 mt-2">No Challenges Active Right Now</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">Create a 7-Day, 30-Day, or Custom Challenge of tasks. The platform generates objectives automatically so you persist without friction!</p>
            <button
              onClick={() => setIsAddingChallenge(true)}
              className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold cursor-pointer transition"
            >
              Set up First Challenge
            </button>
          </div>
        ) : (
          /* Cards Grid */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {challenges.map((c, idx) => {
              const stats = getChallengeStats(c, activeDate);
              return (
                <div 
                  key={c.id}
                  className={`p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col justify-between shadow-xs relative overflow-hidden transition hover:shadow-md ${idx === 0 ? "w-[750px] max-w-full" : ""}`}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 pr-2">
                        <span className="block text-[8px] font-black tracking-widest text-indigo-550 dark:text-indigo-400 uppercase">
                          {c.durationDays}-Day Challenge
                        </span>
                        <h4 className="text-sm font-black text-slate-800 dark:text-white truncate mt-0.5" title={c.name}>
                          {c.name}
                        </h4>
                      </div>

                      {/* delete challenge bin icon */}
                      <button
                        onClick={() => onDeleteChallenge(c.id)}
                        className="p-1 rounded text-slate-400 hover:text-rose-500 hover:bg-rose-500/5 transition cursor-pointer"
                        title="Delete this Challenge"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Streak & Completion info */}
                    <div className="grid grid-cols-2 gap-3 bg-slate-50 dark:bg-slate-950 p-2.5 rounded-xl text-xs">
                      <div className="flex items-center gap-1.5">
                        <Flame className="h-4 w-4 text-amber-500 shrink-0" />
                        <div>
                          <span className="block text-[8px] uppercase text-slate-400 leading-none">Streak</span>
                          <span className="font-extrabold text-slate-800 dark:text-white text-xs leading-none mt-1 block">{stats.currentStreak} Days</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Percent className="h-4 w-4 text-indigo-550 shrink-0" />
                        <div>
                          <span className="block text-[8px] uppercase text-slate-400 leading-none">Completion</span>
                          <span className="font-extrabold text-indigo-505 dark:text-indigo-455 text-xs leading-none mt-1 block">{stats.completionPercentage}%</span>
                        </div>
                      </div>
                    </div>

                    {/* Elapsed text */}
                    <div className="flex justify-between items-center text-[11px] font-medium text-slate-400 dark:text-slate-450 mt-1">
                      <span>Day {stats.daysElapsed} of {c.durationDays}</span>
                      <span>{stats.daysRemaining} Days Left</span>
                    </div>

                    {/* Progress Bar */}
                    <div className="h-2 w-full bg-slate-100 dark:bg-slate-950 rounded-full overflow-hidden block">
                      <div 
                        className="h-full bg-gradient-to-r from-indigo-500 to-indigo-600 rounded-full transition-all"
                        style={{ width: `${Math.min(100, Math.round((stats.daysElapsed / c.durationDays) * 100))}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between text-[10px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" /> Start: {c.startDate}
                    </span>
                    <span className="font-semibold text-slate-500">
                      {c.dailyTasks.length} Daily Tasks
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Challenge Drawer creation Modal */}
      {isAddingChallenge && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-fade-in">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-6 relative">
            <button
              onClick={() => setIsAddingChallenge(false)}
              className="absolute right-4 top-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="text-base font-black text-slate-800 dark:text-white flex items-center gap-1.5 mb-2">
              <Sparkles className="h-5 w-5 text-indigo-500 animate-pulse" />
              Set up Recurring Challenge
            </h3>
            <p className="text-xs text-slate-400 mb-5">Create a long-term habit contract. Daily checkable goals will build up dynamically over time.</p>

            {formError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs font-semibold rounded-xl flex items-center gap-2 mb-4">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleCreateChallengeSubmit} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5">Challenge Name / Focus</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. ServiceNow CAD 60-Day Challenge, Java + DSA 180-Day"
                  value={newChallengeName}
                  onChange={(e) => setNewChallengeName(e.target.value)}
                  className="w-full rounded-xl border border-slate-201 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 p-2.5 text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5">Challenge Duration</label>
                  <select
                    value={newDurationType}
                    onChange={(e) => {
                      setNewDurationType(e.target.value);
                      if (e.target.value !== "custom") setCustomDaysValue("");
                    }}
                    className="w-full rounded-xl border border-slate-201 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 p-2.5 text-xs text-slate-700 dark:text-slate-300 focus:outline-none"
                  >
                    <option value="7">7 Days</option>
                    <option value="30">30 Days</option>
                    <option value="60">60 Days</option>
                    <option value="90">90 Days</option>
                    <option value="180">180 Days</option>
                    <option value="custom">Custom Duration...</option>
                  </select>
                </div>

                {newDurationType === "custom" && (
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5">Custom Days Length</label>
                    <input
                      type="number"
                      required
                      min="1"
                      max="365"
                      placeholder="e.g. 45"
                      value={customDaysValue}
                      onChange={(e) => setCustomDaysValue(e.target.value)}
                      className="w-full rounded-xl border border-slate-201 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 p-2.5 text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                )}
              </div>

              {/* Dynamic list of tasks */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Recurring Daily Tasks</label>
                  <button
                    type="button"
                    onClick={handleAddTaskField}
                    className="text-[10px] font-bold text-indigo-500 hover:text-indigo-600 transition flex items-center gap-0.5 p-1"
                  >
                    <Plus className="h-3 w-3" /> Add Task Line
                  </button>
                </div>

                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {taskInputs.map((taskVal, index) => (
                    <div key={index} className="flex gap-2 items-center">
                      <input
                        type="text"
                        required
                        placeholder={`e.g. Task ${index + 1} definition`}
                        value={taskVal}
                        onChange={(e) => handleTaskInputChange(index, e.target.value)}
                        className="flex-1 rounded-xl border border-slate-201 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 p-2.5 text-xs text-slate-800 dark:text-white focus:outline-none"
                      />
                      {taskInputs.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveTaskField(index)}
                          className="p-2 text-rose-500 hover:bg-rose-500/5 rounded-lg border border-slate-200 dark:border-slate-800"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsAddingChallenge(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white bg-slate-100 dark:bg-slate-800 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow-lg shadow-indigo-600/10 cursor-pointer"
                >
                  Launch Challenge
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Daily checklist orchestrator */}
      <section className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div>
            <h3 className="text-base font-black text-slate-800 dark:text-white flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-indigo-500" />
              Challenge Progression Checklist
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">Mark completions for active challenge contracts on the selected date.</p>
          </div>

          <div className="text-[11px] bg-indigo-500/5 dark:bg-indigo-500/10 border border-indigo-500/20 px-3 py-1.5 rounded-xl text-indigo-550 dark:text-indigo-400 font-bold">
            Selected date: <span className="font-mono text-slate-800 dark:text-white">{activeDate}</span>
          </div>
        </div>

        {challengesOnSelectedDate.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <span className="text-2xl">🌱</span>
            <p className="text-xs font-semibold mt-2">No active challenges start on or before this day.</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Please shift the date navigator forward, or create a challenge to start logging!</p>
          </div>
        ) : (
          <div className="space-y-6">
            {challengesOnSelectedDate.map((c) => {
              // Get logs for this challenge on this specific activeDate
              const dayLogs = logs.filter(l => l.challengeId === c.id && l.date === activeDate);
              
              // A daily challenge is fully completed if all its assigned dailyTasks have 'Completed' status
              const isAllCompleted = c.dailyTasks.length > 0 && c.dailyTasks.every((task) => {
                const log = dayLogs.find(l => l.taskTitle === task);
                return log && log.status === "Completed";
              });

              return (
                <div 
                  key={c.id} 
                  className={`p-5 rounded-2xl relative overflow-hidden transition-all duration-500 border space-y-4 ${
                    isAllCompleted 
                      ? "day-complete-pulse bg-gradient-to-br from-emerald-500/5 to-indigo-500/5 dark:from-emerald-950/10 dark:to-indigo-950/10 border-emerald-500/30"
                      : "bg-slate-50/50 dark:bg-slate-950/40 border-slate-201 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-750"
                  }`}
                >
                  {/* Subtle celebratory background sparkles */}
                  {isAllCompleted && (
                    <div className="absolute top-1.5 right-1.5 opacity-40 text-emerald-400 animate-sparkle-spin pointer-events-none select-none">
                      <Sparkles className="h-5 w-5" />
                    </div>
                  )}

                  {/* Confetti element list (only mounts when fully checked) */}
                  {isAllCompleted && (
                    <div className="absolute inset-0 pointer-events-none select-none overflow-hidden z-10">
                      {/* Left burst particles */}
                      <div className="absolute bottom-2 left-1/4 w-1.5 h-1.5 rounded-sm bg-emerald-400 opacity-0 animate-confetti-1" style={{ animationDelay: '0ms' }} />
                      <div className="absolute bottom-2 left-1/4 w-1.5 h-1.5 rounded-full bg-amber-400 opacity-0 animate-confetti-2" style={{ animationDelay: '200ms' }} />
                      <div className="absolute bottom-2 left-1/4 w-2 h-1 rounded-sm bg-blue-400 opacity-0 animate-confetti-3" style={{ animationDelay: '100ms' }} />
                      
                      {/* Center burst particles */}
                      <div className="absolute bottom-2 left-1/2 w-1.5 h-1.5 rounded-sm bg-rose-400 opacity-0 animate-confetti-1" style={{ animationDelay: '150ms' }} />
                      <div className="absolute bottom-2 left-1/2 w-2 h-2 rounded bg-indigo-400 opacity-0 animate-confetti-4" style={{ animationDelay: '50ms' }} />
                      <div className="absolute bottom-2 left-1/2 w-1.5 h-2.5 rounded-full bg-teal-400 opacity-0 animate-confetti-5" style={{ animationDelay: '300ms' }} />
                      
                      {/* Right burst particles */}
                      <div className="absolute bottom-2 right-1/4 w-2 h-1.5 rounded-sm bg-indigo-300 opacity-0 animate-confetti-3" style={{ animationDelay: '250ms' }} />
                      <div className="absolute bottom-2 right-1/4 w-1.5 h-1.5 rounded bg-amber-300 opacity-0 animate-confetti-4" style={{ animationDelay: '350ms' }} />
                      <div className="absolute bottom-2 right-1/4 w-1.5 h-1.5 rounded-full bg-purple-400 opacity-0 animate-confetti-2" style={{ animationDelay: '50ms' }} />
                    </div>
                  )}

                  <div className="flex items-center justify-between relative z-1 pointer-events-auto">
                    <span className="text-xs font-black text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
                      🔥 {c.name}
                    </span>
                    {isAllCompleted ? (
                      <span className="text-[10px] uppercase font-black text-emerald-600 dark:text-emerald-400 flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full animate-pulse select-none">
                        <Sparkles className="h-3 w-3 text-emerald-500 dark:text-emerald-400" />
                        Day Complete!
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold text-slate-400">
                        {dayLogs.filter(l => l.status === "Completed" || l.status === "Partial").length} of {c.dailyTasks.length} Checked
                      </span>
                    )}
                  </div>

                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {c.dailyTasks.map((task) => {
                      const log = dayLogs.find(l => l.taskTitle === task);
                      const currentStatus = log ? log.status : "Uncompleted";

                      return (
                        <div 
                          key={task} 
                          className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                          id={`task-row-${c.id}-${task.replace(/\s+/g, "-")}`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {/* Checkbox state rendering dynamically based on state */}
                            <span className={`h-4.5 w-4.5 rounded-md flex items-center justify-center border font-bold shrink-0 ${
                              currentStatus === "Completed" 
                                ? "bg-emerald-500 border-emerald-500 text-white" 
                                : currentStatus === "Partial"
                                ? "bg-amber-500 border-amber-500 text-white"
                                : currentStatus === "Skipped"
                                ? "bg-slate-400 border-slate-400 text-white"
                                : "border-slate-300 dark:border-slate-700 text-transparent"
                            }`}>
                              {currentStatus === "Completed" && <Check className="h-3 w-3 stroke-[3]" />}
                              {currentStatus === "Partial" && "P"}
                              {currentStatus === "Skipped" && "S"}
                            </span>

                            <span className={`font-semibold truncate ${
                              currentStatus === "Completed" ? "line-through text-slate-400" : "text-slate-800 dark:text-slate-100"
                            }`}>
                              {task}
                            </span>
                          </div>

                          {/* Action completion triggers */}
                          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-900 p-1 rounded-xl border border-slate-200/50 dark:border-slate-800 self-end sm:self-auto">
                            
                            {/* Complete Task Option */}
                            <button
                              onClick={() => {
                                const newStatus = currentStatus === "Completed" ? "Uncompleted" : "Completed";
                                onUpdateLogStatus(c.id, activeDate, task, newStatus);
                              }}
                              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition flex items-center gap-1 ${
                                currentStatus === "Completed"
                                  ? "bg-emerald-550 dark:bg-emerald-600 bg-emerald-500 text-white shadow-xs"
                                  : "text-slate-450 hover:text-emerald-555 hover:bg-slate-50 dark:hover:bg-slate-950/20"
                              }`}
                              title="Mark Fully Completed"
                            >
                              Complete
                            </button>

                            {/* Partial Task Option */}
                            <button
                              onClick={() => {
                                const newStatus = currentStatus === "Partial" ? "Uncompleted" : "Partial";
                                onUpdateLogStatus(c.id, activeDate, task, newStatus);
                              }}
                              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition ${
                                currentStatus === "Partial"
                                  ? "bg-amber-500 text-white shadow-xs"
                                  : "text-slate-450 hover:text-amber-555 hover:bg-slate-50 dark:hover:bg-slate-950/20"
                              }`}
                              title="Mark Partials (e.g. completed task elements)"
                            >
                              Partial
                            </button>

                            {/* Skip Task Option */}
                            <button
                              onClick={() => {
                                const newStatus = currentStatus === "Skipped" ? "Uncompleted" : "Skipped";
                                onUpdateLogStatus(c.id, activeDate, task, newStatus);
                              }}
                              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition ${
                                currentStatus === "Skipped"
                                  ? "bg-slate-500 dark:bg-slate-700 text-white shadow-xs"
                                  : "text-slate-450 hover:text-rose-500 hover:bg-slate-50 dark:hover:bg-slate-950/20"
                              }`}
                              title="Skip logging this task today"
                            >
                              Skip
                            </button>

                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Notes & Milestones Expandable Panels */}
                  <div className="pt-4 border-t border-slate-250 dark:border-slate-800 space-y-4">
                    {/* 1. Goals/Milestones Section */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-wider flex items-center gap-1">
                          🎯 Challenge Goals & Milestones
                        </span>
                        <span className="text-[9px] font-semibold text-indigo-500 bg-indigo-500/10 dark:bg-indigo-500/5 px-2 py-0.5 rounded-full">
                          {goals.filter(g => g.challengeId === c.id && g.completed).length}/{goals.filter(g => g.challengeId === c.id).length} Done
                        </span>
                      </div>
                      
                      {/* Goals List of this challenge */}
                      <div className="space-y-1.5 max-h-36 overflow-y-auto">
                        {goals.filter(g => g.challengeId === c.id).length === 0 ? (
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">No milestones defined yet. Set one below!</p>
                        ) : (
                          goals.filter(g => g.challengeId === c.id).map(g => (
                            <div key={g.id} className="flex items-center justify-between bg-slate-100/50 dark:bg-slate-950/30 p-1.5 rounded-xl border border-slate-200/40 dark:border-slate-800/40">
                              <label className="flex items-center gap-1.5 pr-1 min-w-0 flex-1 cursor-pointer">
                                <input 
                                  type="checkbox"
                                  checked={g.completed}
                                  onChange={(e) => onToggleGoal(g.id, e.target.checked)}
                                  className="h-3 w-3 rounded text-indigo-600 focus:ring-indigo-500 shrink-0"
                                />
                                <span className={`text-[11px] truncate ${g.completed ? "line-through text-slate-400 dark:text-slate-500" : "text-slate-700 dark:text-slate-200 font-semibold"}`}>
                                  {g.title}
                                </span>
                              </label>
                              <div className="flex items-center gap-1.5 shrink-0 text-[9px] text-slate-400">
                                <span className="font-mono bg-slate-200/60 dark:bg-slate-800 px-1 py-0.5 rounded text-[8px]">{g.targetDate}</span>
                                <button 
                                  type="button"
                                  onClick={() => onDeleteGoal(g.id)}
                                  className="text-rose-500 hover:text-rose-600 font-bold p-0.5 text-xs"
                                  title="Delete goal"
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                      {/* Add Goal Mini-Form */}
                      <PlannerGoalForm challengeId={c.id} onCreateGoal={onCreateGoal} activeDate={activeDate} />
                    </div>

                    {/* 2. Reflections & Notes Section */}
                    <div className="space-y-2 pt-2 border-t border-slate-150/40 dark:border-slate-850/40">
                      <span className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-wider flex items-center gap-1">
                        📝 Daily Reflection & Notes
                      </span>
                      <PlannerNoteField 
                        challengeId={c.id} 
                        date={activeDate} 
                        notes={notes} 
                        onSaveNote={onSaveNote} 
                      />
                    </div>
                  </div>

                </div>
              );
            })}
          </div>
        )}
      </section>

    </div>
  );
}

// Self-contained Goal Creation mini-form for a specific challenge
function PlannerGoalForm({ 
  challengeId, 
  onCreateGoal, 
  activeDate 
}: { 
  challengeId: string; 
  onCreateGoal: (title: string, targetDate: string, challengeId?: string) => Promise<void>; 
  activeDate: string; 
}) {
  const [goalTitle, setGoalTitle] = useState("");
  const [targetDate, setTargetDate] = useState(activeDate);
  const [isAddingGoal, setIsAddingGoal] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goalTitle.trim()) return;
    await onCreateGoal(goalTitle.trim(), targetDate, challengeId);
    setGoalTitle("");
    setIsAddingGoal(false);
  };

  if (!isAddingGoal) {
    return (
      <button
        type="button"
        onClick={() => setIsAddingGoal(true)}
        className="text-[9px] font-bold text-indigo-500 hover:text-indigo-650 dark:hover:text-indigo-400 transition flex items-center gap-0.5 p-0.5 cursor-pointer"
      >
        <Plus className="h-2.5 w-2.5" /> Add Challenge Goal
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1.5 bg-slate-50 dark:bg-slate-950 p-2 rounded-xl border border-slate-200/50 dark:border-slate-850/60 mt-1">
      <input 
        type="text"
        required
        placeholder="Goal (e.g. Pass exam, 2h deep focus)"
        value={goalTitle}
        onChange={(e) => setGoalTitle(e.target.value)}
        className="text-[10px] w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-1.5 text-slate-800 dark:text-white focus:outline-none"
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-[9px] text-slate-400">
          <span>Target Date:</span>
          <input 
            type="date"
            required
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="bg-transparent text-[9px] focus:outline-none text-slate-600 dark:text-slate-350 cursor-pointer"
          />
        </div>
        <div className="flex gap-1.5">
          <button 
            type="button"
            onClick={() => setIsAddingGoal(false)}
            className="text-[9px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 px-1"
          >
            Cancel
          </button>
          <button 
            type="submit"
            className="text-[9px] text-white bg-indigo-600 hover:bg-indigo-500 font-bold px-2 py-0.5 rounded-md cursor-pointer"
          >
            Add
          </button>
        </div>
      </div>
    </form>
  );
}

// Self-contained Notes Reflection field showing reflections for a challenge on a specific date
function PlannerNoteField({
  challengeId,
  date,
  notes,
  onSaveNote
}: {
  challengeId: string;
  date: string;
  notes: UserNote[];
  onSaveNote: (challengeId: string | undefined, date: string, content: string) => Promise<void>;
}) {
  const currentNote = notes.find(n => n.challengeId === challengeId && n.date === date);
  const [noteText, setNoteText] = useState("");
  const [lastSyncedKey, setLastSyncedKey] = useState("");

  const combinedKey = `${challengeId}-${date}`;
  if (lastSyncedKey !== combinedKey) {
    setNoteText(currentNote ? currentNote.content : "");
    setLastSyncedKey(combinedKey);
  }

  const handleSave = async () => {
    await onSaveNote(challengeId, date, noteText);
  };

  const isChanged = noteText !== (currentNote ? currentNote.content : "");

  return (
    <div className="space-y-1.5">
      <textarea
        placeholder="Write a private progress note or review reflections for today..."
        value={noteText}
        onChange={(e) => setNoteText(e.target.value)}
        rows={2}
        className="w-full text-[11px] leading-relaxed bg-slate-50 dark:bg-slate-950 p-2 rounded-xl border border-slate-200/50 dark:border-slate-800 text-slate-750 dark:text-slate-300 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
      />
      {isChanged && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            className="text-[10px] bg-indigo-600 hover:bg-indigo-500 text-white px-2.5 py-0.5 rounded-lg font-bold transition shadow-md shadow-indigo-600/10 cursor-pointer"
          >
            Save Note
          </button>
        </div>
      )}
    </div>
  );
}
