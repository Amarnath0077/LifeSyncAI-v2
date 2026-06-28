import React, { useState, useEffect } from "react";
import { 
  Sparkles, LogOut, Sun, Moon, Calendar, Activity, ClipboardList, AlertCircle, Plus, BrainCircuit
} from "lucide-react";
import AuthView from "./components/AuthView";
import PlannerView from "./components/PlannerView";
import AnalyticsView from "./components/AnalyticsView";
import { 
  Challenge, ChallengeDailyLog, User as UserType, 
  UserNote, UserGoal, Achievement, NotificationSetting, 
  InAppNotification, ProgressReport 
} from "./types";
import { 
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, serverTimestamp 
} from "firebase/firestore";
import { db, auth, handleFirestoreError, OperationType } from "./firebase";
import { signOut } from "firebase/auth";
import NotificationBell from "./components/NotificationBell";
import useNotifications from "./hooks/useNotifications";
import { requestNotificationPermission, getFcmToken, listenForForegroundMessages } from "./services/fcmService";
import { initializeEmailSchedulers } from "./lib/scheduler";

export default function App() {
  // Session tracking
  const [currentUser, setCurrentUser] = useState<UserType | null>(() => {
    const saved = localStorage.getItem("planner_user");
    if (saved) {
      try {
        const u = JSON.parse(saved);
        if (u && u.id !== "demo-user") {
          return u;
        }
      } catch (e) {}
    }
    return null;
  });

  const [authInitializing, setAuthInitializing] = useState<boolean>(true);

  // Client states
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [logs, setLogs] = useState<ChallengeDailyLog[]>([]);
  const [notes, setNotes] = useState<UserNote[]>([]);
  const [goals, setGoals] = useState<UserGoal[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [notifSettings, setNotifSettings] = useState<NotificationSetting | null>(null);
  const [reports, setReports] = useState<ProgressReport[]>([]);
  const [welcomeNotifSent, setWelcomeNotifSent] = useState<boolean>(false);
  const { notifications: realtimeNotifications, unreadCount, loading: realtimeNotificationsLoading, markAsRead } = useNotifications(currentUser?.id);
  
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // App navigation
  const [activeTab, setActiveTab] = useState<"planner" | "analytics">("planner");
  const [activeDate, setActiveDate] = useState<string>(() => {
    return new Date().toISOString().split("T")[0];
  });

  // Theme support (default dark)
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("planner_theme");
    return (saved as "dark" | "light") || "dark";
  });

  // Sync theme to document root
  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("planner_theme", theme);
  }, [theme]);

  // Sync Firebase Auth states
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        const u: UserType = {
          id: user.uid,
          name: user.displayName || user.email?.split("@")[0] || "User",
          email: user.email || ""
        };
        setCurrentUser(u);
        localStorage.setItem("planner_user", JSON.stringify(u));

        // Step 11: Automatic User Document Creation
        try {
          const userDocRef = doc(db, "users", user.uid);
          const uDoc = await getDoc(userDocRef);
          if (!uDoc.exists()) {
            const newUserDoc = {
              uid: user.uid,
              name: user.displayName || user.email?.split("@")[0] || "User",
              email: user.email || "",
              photoURL: user.photoURL || "",
              createdAt: new Date().toISOString()
            };
            await setDoc(userDocRef, newUserDoc)
              .catch(e => handleFirestoreError(e, OperationType.CREATE, `users/${user.uid}`));
          }
        } catch (e) {
          console.error("Error ensuring user profile document exists:", e);
        }
      } else {
        setCurrentUser(null);
        localStorage.removeItem("planner_user");
      }
      setAuthInitializing(false);
    });
    return () => unsubscribe();
  }, []);

  // Sync session and fetch challenges / logs
  useEffect(() => {
    if (currentUser && auth.currentUser && auth.currentUser.uid === currentUser.id) {
      fetchData();
    } else if (!currentUser) {
      setChallenges([]);
      setLogs([]);
      setNotes([]);
      setGoals([]);
      setAchievements([]);
      setNotifications([]);
      setNotifSettings(null);
      setReports([]);
    }
  }, [currentUser]);

  // Hook up client-side background email scheduler on login
  useEffect(() => {
    if (currentUser?.id) {
      const cleanup = initializeEmailSchedulers(currentUser.id, (campaign, success, data) => {
        console.log(`[App Scheduler] Background check triggered campaign: ${campaign}. Success: ${success}`, data);
      });
      return () => cleanup();
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (currentUser) {
      setNotifications(realtimeNotifications);
    }
  }, [currentUser?.id, realtimeNotifications]);

  useEffect(() => {
    if (!currentUser?.id || welcomeNotifSent) return;

    const initializePush = async () => {
      try {
        const permissionGranted = await requestNotificationPermission();
        if (!permissionGranted) {
          await setDoc(doc(db, "users", currentUser.id), { notificationEnabled: false }, { merge: true });
          return;
        }

        const token = await getFcmToken();
        if (token) {
          await setDoc(
            doc(db, "users", currentUser.id),
            {
              fcmToken: token,
              notificationEnabled: true,
              lastTokenUpdate: serverTimestamp(),
            },
            { merge: true }
          );
        } else {
          await setDoc(doc(db, "users", currentUser.id), { notificationEnabled: false }, { merge: true });
        }

        listenForForegroundMessages((payload) => {
          const title = payload.notification?.title || payload.title || "LifeSync AI";
          const body = payload.notification?.body || payload.body || "You have a new notification.";
          if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
            new Notification(title, { body, icon: "/icon-192.png" });
          }
        });
      } catch (error) {
        console.error("FCM initialization failed", error);
      }
    };

    initializePush();
    createNotificationDocuments({
      type: "system",
      title: "Welcome Back",
      message: "Ready to achieve today's goals?",
    });
    setWelcomeNotifSent(true);
  }, [currentUser?.id, welcomeNotifSent]);

  // Bulk data loader
  const fetchData = async () => {
    if (!currentUser) return;
    setLoading(true);
    setError(null);
    try {
      const uid = currentUser.id;
      
      const [
        challengesSnap, logsSnap, notesSnap, goalsSnap, achievementsSnap, notifsSnap, settingsSnap, reportsSnap
      ] = await Promise.all([
        getDocs(collection(db, "users", uid, "challenges"))
          .catch(e => handleFirestoreError(e, OperationType.LIST, `users/${uid}/challenges`)),
        getDocs(collection(db, "users", uid, "tasks"))
          .catch(e => handleFirestoreError(e, OperationType.LIST, `users/${uid}/tasks`)),
        getDocs(collection(db, "users", uid, "notes"))
          .catch(e => handleFirestoreError(e, OperationType.LIST, `users/${uid}/notes`)),
        getDocs(collection(db, "users", uid, "goals"))
          .catch(e => handleFirestoreError(e, OperationType.LIST, `users/${uid}/goals`)),
        getDocs(collection(db, "users", uid, "achievements"))
          .catch(e => handleFirestoreError(e, OperationType.LIST, `users/${uid}/achievements`)),
        getDocs(collection(db, "users", uid, "notifications"))
          .catch(e => handleFirestoreError(e, OperationType.LIST, `users/${uid}/notifications`)),
        getDoc(doc(db, "users", uid, "notification_preferences", "settings"))
          .catch(e => handleFirestoreError(e, OperationType.GET, `users/${uid}/notification_preferences/settings`)),
        getDocs(collection(db, "users", uid, "analytics"))
          .catch(e => handleFirestoreError(e, OperationType.LIST, `users/${uid}/analytics`))
      ]);

      const challengesData = challengesSnap ? challengesSnap.docs.map(d => ({ ...d.data(), id: d.id })) : [];
      const logsData = logsSnap ? logsSnap.docs.map(d => ({ ...d.data(), id: d.id })) : [];
      const notesData = notesSnap ? notesSnap.docs.map(d => ({ ...d.data(), id: d.id })) : [];
      const goalsData = goalsSnap ? goalsSnap.docs.map(d => ({ ...d.data(), id: d.id })) : [];
      const achievementsData = achievementsSnap ? achievementsSnap.docs.map(d => ({ ...d.data(), id: d.id })) : [];
      const notificationsData = notifsSnap ? notifsSnap.docs.map(d => ({ ...d.data(), id: d.id })) : [];
      
      let settingsData = null;
      if (settingsSnap && settingsSnap.exists()) {
        settingsData = settingsSnap.data() as NotificationSetting;
      } else {
        const defaultSettings: NotificationSetting = {
          userId: uid,
          morningEnabled: true,
          eveningEnabled: true,
          eodEnabled: true,
          emailEnabled: false,
          pushEnabled: false,
          inAppEnabled: true,
          emailProvider: "resend",
          morningTime: "08:00",
          eveningTime: "18:05",
          eodTime: "22:00",
          weeklyReportDay: 0,
          monthlyReportDay: "first"
        };
        await setDoc(doc(db, "users", uid, "notification_preferences", "settings"), defaultSettings)
          .catch(e => handleFirestoreError(e, OperationType.CREATE, `users/${uid}/notification_preferences/settings`));
        settingsData = defaultSettings;
      }
      
      const reportsData = reportsSnap ? reportsSnap.docs.map(d => ({ ...d.data(), id: d.id })) : [];

      setChallenges(challengesData as Challenge[]);
      setLogs(logsData as ChallengeDailyLog[]);
      setNotes(notesData as UserNote[]);
      setGoals(goalsData as UserGoal[]);
      setAchievements(achievementsData as Achievement[]);
      setNotifications(notificationsData as InAppNotification[]);
      setNotifSettings(settingsData as NotificationSetting | null);
      setReports(reportsData as ProgressReport[]);
    } catch (err: any) {
      setError(err.message || "Failed to fully synchronize user data with Firestore.");
    } finally {
      setLoading(false);
    }
  };

  // Add Challenge
  const handleAddChallenge = async (challengeData: {
    name: string;
    startDate: string;
    durationDays: number;
    dailyTasks: string[];
  }) => {
    if (!currentUser) return;
    setError(null);
    try {
      const challengeRef = doc(collection(db, "users", currentUser.id, "challenges"));
      const newChallenge: Challenge = {
        id: challengeRef.id,
        userId: currentUser.id,
        name: challengeData.name,
        startDate: challengeData.startDate,
        durationDays: challengeData.durationDays,
        dailyTasks: challengeData.dailyTasks,
        createdAt: new Date().toISOString()
      };
      await setDoc(challengeRef, newChallenge)
        .catch(e => handleFirestoreError(e, OperationType.CREATE, `users/${currentUser.id}/challenges/${challengeRef.id}`));
      setChallenges((prev) => [...prev, newChallenge]);
    } catch (err: any) {
      setError(err.message || "Could not register new challenge.");
      throw err;
    }
  };

  // Helper function to trigger campaign emails via server API
  const triggerCampaignEmail = async (campaign: string, data: any) => {
    if (!currentUser) return;
    try {
      const res = await fetch("/api/emails/trigger-campaign", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-user-id": currentUser.id,
  },
  body: JSON.stringify({
    userId: currentUser.id,
    campaign,
    userName: currentUser.name,
    userEmail: currentUser.email,
    clientSettings: notifSettings,
    compiledData: data,
  }),
});

console.log("STATUS:", res.status);

const response = await res.json();

console.log("SERVER RESPONSE:", response);
       
    } catch (e) {
      console.error(`Error triggering campaign email: ${campaign}`, e);
    }
  };

  // Helper to calculate overall cumulative streak across active challenges
  const getOverallStreak = (currentLogs = logs) => {
    const getStreakForChallenge = (c: Challenge) => {
      const challengeLogs = currentLogs.filter((l) => l.challengeId === c.id);
      if (challengeLogs.length === 0) return 0;
      const hasSuccess = (d: string) => {
        const logsForDay = challengeLogs.filter((l) => l.date === d);
        if (logsForDay.length === 0) return false;
        return logsForDay.some((l) => l.status === "Completed" || l.status === "Partial");
      };

      let streak = 0;
      const checkDate = new Date();
      for (let i = 0; i < 180; i++) {
        const dStr = checkDate.toISOString().split("T")[0];
        if (hasSuccess(dStr)) {
          streak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          if (i === 0) {
            checkDate.setDate(checkDate.getDate() - 1);
            const yStr = checkDate.toISOString().split("T")[0];
            if (hasSuccess(yStr)) {
              streak++;
              checkDate.setDate(checkDate.getDate() - 1);
              continue;
            }
          }
          break;
        }
      }
      return streak;
    };

    return challenges.length > 0 ? Math.max(...challenges.map((c) => getStreakForChallenge(c)), 0) : 0;
  };

  // Log a daily completion task action with gamified motivation engine triggers
  const handleUpdateLogStatus = async (
    challengeId: string, 
    date: string, 
    taskTitle: string, 
    status: "Completed" | "Skipped" | "Partial" | "Uncompleted"
  ) => {
    if (!currentUser) return;
    try {
      const existingLog = logs.find(l => 
        l.userId === currentUser.id && 
        l.challengeId === challengeId && 
        l.date === date && 
        l.taskTitle === taskTitle
      );

      const prevStreak = getOverallStreak(logs);
      let updatedLogsList = [...logs];

      if (existingLog) {
        if (status === "Uncompleted") {
          await deleteDoc(doc(db, "users", currentUser.id, "tasks", existingLog.id))
            .catch(e => handleFirestoreError(e, OperationType.DELETE, `users/${currentUser.id}/tasks/${existingLog.id}`));
          updatedLogsList = logs.filter(l => l.id !== existingLog.id);
          setLogs(updatedLogsList);
        } else {
          await updateDoc(doc(db, "users", currentUser.id, "tasks", existingLog.id), { status })
            .catch(e => handleFirestoreError(e, OperationType.UPDATE, `users/${currentUser.id}/tasks/${existingLog.id}`));
          updatedLogsList = logs.map(l => l.id === existingLog.id ? { ...l, status } : l);
          setLogs(updatedLogsList);
        }
      } else if (status !== "Uncompleted") {
        const logRef = doc(collection(db, "users", currentUser.id, "tasks"));
        const newLog: ChallengeDailyLog = {
          id: logRef.id,
          challengeId,
          userId: currentUser.id,
          date,
          taskTitle,
          status
        };
        await setDoc(logRef, newLog)
          .catch(e => handleFirestoreError(e, OperationType.CREATE, `users/${currentUser.id}/tasks/${logRef.id}`));
        updatedLogsList = [...logs, newLog];
        setLogs(updatedLogsList);
      }

      // Check Real-Time Notification & Gamification triggers
      if (status === "Completed") {
        const challenge = challenges.find(c => c.id === challengeId);
        const challengeName = challenge ? challenge.name : "Habit Contract";
        const challengeLogs = updatedLogsList.filter(l => l.challengeId === challengeId);
        
        const completedCount = challengeLogs.filter(l => l.status === "Completed").length;
        const totalCount = challenge ? (challenge.durationDays * (challenge.dailyTasks?.length || 1)) : 30;
        
        // 1. Task Completed Alert & Email
        handleSimulateNotif({
          type: "system",
          title: "✅ Contract Task Completed",
          message: `Nice work! Task "${taskTitle}" of "${challengeName}" has been successfully completed in the database.`
        });
        triggerCampaignEmail("task_completed", {
          taskTitle,
          challengeName,
          completedTasksCount: completedCount,
          totalTasksCount: totalCount
        });

        // 2. Streak progression validation
        const newStreak = getOverallStreak(updatedLogsList);
        if (newStreak > prevStreak) {
          handleSimulateNotif({
            type: "system",
            title: "🔥 Streak Levels Amplified!",
            message: `Congratulations! Your daily habits streak has reached a consecutive balance of ${newStreak} Days!`
          });
          triggerCampaignEmail("streak_increased", {
            streak: newStreak
          });

          // Unlocking streak-based badges
          if (newStreak === 3) {
            handleUnlockAchievement("Consistency Spark", "Maintained an active habits streak for 3 consecutive days!");
          } else if (newStreak === 7) {
            handleUnlockAchievement("Weekly General", "Maintained an active habits streak for 7 consecutive days!");
          } else if (newStreak === 14) {
            handleUnlockAchievement("Fortnight Focus", "Maintained an active habits streak for 14 consecutive days!");
          } else if (newStreak === 30) {
            handleUnlockAchievement("Identity Level Master", "Maintained an active habits streak for 30 consecutive days. Your discipline is your identity!");
          } else if (newStreak === 100) {
            handleUnlockAchievement("Century Streak", "Maintained an incredible 100-day streak! Your habit identity is unwavering.");
          }
        }

        // 3. Challenge Milestones Met Check (25%, 50%, 75%, 100%)
        if (totalCount > 0) {
          const prevCompletedCount = completedCount - 1;
          const prevPct = Math.floor((prevCompletedCount / totalCount) * 100);
          const newPct = Math.floor((completedCount / totalCount) * 100);
          const milestones = [25, 50, 75, 100];

          for (const m of milestones) {
            if (prevPct < m && newPct >= m) {
              handleSimulateNotif({
                type: "system",
                title: `🏆 ${m}% Milestone Cricked!`,
                message: `Tremendous effort! You've crossed ${m}% completion on your contract: "${challengeName}"!`
              });
              triggerCampaignEmail(`milestone_${m}`, {
                challengeName,
                streak: newStreak,
                daysElapsed: Math.max(1, Math.round((challenge?.durationDays || 30) * (m / 100)))
              });

              if (m === 100) {
                handleUnlockAchievement("Unyielding Warrior", `Completed 100% of the active habit contract "${challengeName}"!`);
              }
            }
          }
        }
      }
    } catch (err: any) {
      setError(err.message || "Failed to synchronize completion status with Firestore.");
    }
  };

  // Delete challenge
  const handleDeleteChallenge = async (challengeId: string) => {
    if (!currentUser) return;
    try {
      await deleteDoc(doc(db, "users", currentUser.id, "challenges", challengeId))
        .catch(e => handleFirestoreError(e, OperationType.DELETE, `users/${currentUser.id}/challenges/${challengeId}`));

      const assocLogs = logs.filter(l => l.challengeId === challengeId);
      await Promise.all(
        assocLogs.map(l => deleteDoc(doc(db, "users", currentUser.id, "tasks", l.id))
          .catch(e => handleFirestoreError(e, OperationType.DELETE, `users/${currentUser.id}/tasks/${l.id}`)))
      );

      setChallenges((prev) => prev.filter((c) => c.id !== challengeId));
      setLogs((prev) => prev.filter((l) => l.challengeId !== challengeId));
    } catch (err: any) {
      setError(err.message || "Failed to delete challenge.");
    }
  };

  // Save daily note
  const handleSaveNote = async (challengeId: string | undefined, date: string, content: string) => {
    if (!currentUser) return;
    try {
      const existingNote = notes.find(n => 
        n.userId === currentUser.id && 
        n.date === date && 
        n.challengeId === challengeId
      );

      if (existingNote) {
        if (!content.trim()) {
          await deleteDoc(doc(db, "users", currentUser.id, "notes", existingNote.id))
            .catch(e => handleFirestoreError(e, OperationType.DELETE, `users/${currentUser.id}/notes/${existingNote.id}`));
          setNotes(prev => prev.filter(n => n.id !== existingNote.id));
        } else {
          await updateDoc(doc(db, "users", currentUser.id, "notes", existingNote.id), { content })
            .catch(e => handleFirestoreError(e, OperationType.UPDATE, `users/${currentUser.id}/notes/${existingNote.id}`));
          setNotes(prev => prev.map(n => n.id === existingNote.id ? { ...n, content } : n));
        }
      } else if (content.trim()) {
        const noteRef = doc(collection(db, "users", currentUser.id, "notes"));
        const newNote: UserNote = {
          id: noteRef.id,
          userId: currentUser.id,
          date,
          content,
          createdAt: new Date().toISOString()
        };
        if (challengeId) {
          newNote.challengeId = challengeId;
        }
        await setDoc(noteRef, newNote)
          .catch(e => handleFirestoreError(e, OperationType.CREATE, `users/${currentUser.id}/notes/${noteRef.id}`));
        setNotes(prev => [...prev, newNote]);
      }
    } catch (e) {
      console.error("Error saving note to database", e);
    }
  };

  // Create Goal
  const handleCreateGoal = async (title: string, targetDate: string, challengeId?: string) => {
    if (!currentUser) return;
    try {
      const goalRef = doc(collection(db, "users", currentUser.id, "goals"));
      const newGoal: UserGoal = {
        id: goalRef.id,
        userId: currentUser.id,
        title,
        targetDate,
        completed: false,
        createdAt: new Date().toISOString()
      };
      if (challengeId) {
        newGoal.challengeId = challengeId;
      }
      await setDoc(goalRef, newGoal)
        .catch(e => handleFirestoreError(e, OperationType.CREATE, `users/${currentUser.id}/goals/${goalRef.id}`));
      
      setGoals((prev) => [...prev, newGoal]);
      handleUnlockAchievement("Goal Creator", "Registered a custom goal target!");
    } catch (e) {
      console.error("Error creating goal", e);
    }
  };

  // Toggle Goal Completed
  const handleToggleGoal = async (id: string, completed: boolean) => {
    if (!currentUser) return;
    try {
      const completedAt = completed ? new Date().toISOString() : undefined;
      await updateDoc(doc(db, "users", currentUser.id, "goals", id), { 
        completed,
        ...(completedAt ? { completedAt } : {})
      }).catch(e => handleFirestoreError(e, OperationType.UPDATE, `users/${currentUser.id}/goals/${id}`));

      setGoals((prev) => prev.map((g) => g.id === id ? { ...g, completed, completedAt } : g));
      if (completed) {
        handleUnlockAchievement("Milestone Conquered", "Marked a custom high-priority milestone goal in the database!");
      }
    } catch (e) {
      console.error("Error updating goal state", e);
    }
  };

  // Delete Goal
  const handleDeleteGoal = async (id: string) => {
    if (!currentUser) return;
    try {
      await deleteDoc(doc(db, "users", currentUser.id, "goals", id))
        .catch(e => handleFirestoreError(e, OperationType.DELETE, `users/${currentUser.id}/goals/${id}`));
      setGoals((prev) => prev.filter((g) => g.id !== id));
    } catch (e) {
      console.error("Error deleting goal", e);
    }
  };

  // Unlock Achievement
  const handleUnlockAchievement = async (title: string, description: string) => {
    if (!currentUser) return;
    try {
      const hasAch = achievements.some(a => a.title === title);
      if (hasAch) return;

      const achRef = doc(collection(db, "users", currentUser.id, "achievements"));
      const newAch: Achievement = {
        id: achRef.id,
        userId: currentUser.id,
        title,
        description,
        unlockedAt: new Date().toISOString()
      };
      await setDoc(achRef, newAch)
        .catch(e => handleFirestoreError(e, OperationType.CREATE, `users/${currentUser.id}/achievements/${achRef.id}`));

      setAchievements((prev) => [...prev, newAch]);
      handleSimulateNotif({
        type: "system",
        title: `🏆 Medal Awarded: ${title}`,
        message: `Congratulations! You unlocked the achievement: "${description}". Check details on your history cupboard.`
      });
      triggerCampaignEmail("achievement_unlocked", {
        achievementTitle: title,
        achievementDescription: description
      });
    } catch (e) {
      console.error("Error unlocking achievement", e);
    }
  };

  // Update Notification settings
  const handleUpdateNotifSettings = async (settings: Partial<NotificationSetting>) => {
    if (!currentUser) return;
    try {
      const mergedSettings = {
        ...notifSettings,
        ...settings,
        userId: currentUser.id
      };
      await setDoc(doc(db, "users", currentUser.id, "notification_preferences", "settings"), mergedSettings)
        .catch(e => handleFirestoreError(e, OperationType.UPDATE, `users/${currentUser.id}/notification_preferences/settings`));
      setNotifSettings(mergedSettings as NotificationSetting);
    } catch (e) {
      console.error("Error saving notification settings", e);
    }
  };

  // Mark all or single notification as read
  const handleMarkNotifsRead = async (id?: string, all?: boolean) => {
    if (!currentUser) return;
    try {
      if (all) {
        const unreadNotifs = notifications.filter(n => !n.read);
        await Promise.all(
          unreadNotifs.map(n => updateDoc(doc(db, "users", currentUser.id, "notifications", n.id), { read: true })
            .catch(e => handleFirestoreError(e, OperationType.UPDATE, `users/${currentUser.id}/notifications/${n.id}`)))
        );
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      } else if (id) {
        await updateDoc(doc(db, "users", currentUser.id, "notifications", id), { read: true })
          .catch(e => handleFirestoreError(e, OperationType.UPDATE, `users/${currentUser.id}/notifications/${id}`));
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
      }
    } catch (e) {
      console.error("Status update error", e);
    }
  };

  async function createNotificationDocuments(params: { type: "morning" | "evening" | "eod" | "system"; title: string; message: string; }) {
    if (!currentUser) return;
    try {
      const notifRef = doc(collection(db, "users", currentUser.id, "notifications"));
      const newNotif: InAppNotification = {
        id: notifRef.id,
        userId: currentUser.id,
        type: params.type,
        title: params.title,
        message: params.message,
        date: activeDate,
        read: false,
        createdAt: new Date().toISOString(),
      };

      const rootNotif = {
        id: notifRef.id,
        userId: currentUser.id,
        title: params.title,
        message: params.message,
        type: params.type,
        read: false,
        createdAt: serverTimestamp(),
      };

      await Promise.all([
        setDoc(notifRef, newNotif).catch((e) => handleFirestoreError(e, OperationType.CREATE, `users/${currentUser.id}/notifications/${notifRef.id}`)),
        setDoc(doc(db, "notifications", notifRef.id), rootNotif).catch((e) => handleFirestoreError(e, OperationType.CREATE, `notifications/${notifRef.id}`)),
      ]);
      setNotifications((prev) => [newNotif, ...prev]);
    } catch (e) {
      console.error("Error creating notification documents", e);
    }
  }

  // Simulate Trigger Daily Notification
  const handleSimulateNotif = async (params: { type: "morning" | "evening" | "eod" | "system", title: string, message: string }) => {
    await createNotificationDocuments(params);
  };

  // Save progress report permanently
  const handleSaveReport = async (report: Omit<ProgressReport, "id" | "userId" | "createdAt" | "score"> & { score?: number }) => {
    if (!currentUser) return;
    try {
      const reportRef = doc(collection(db, "users", currentUser.id, "analytics"));
      const newReport: ProgressReport = {
        id: reportRef.id,
        userId: currentUser.id,
        type: report.type,
        periodStr: report.periodStr,
        dateKey: report.dateKey,
        completionRate: report.completionRate,
        totalHours: report.totalHours,
        bestDay: report.bestDay || "",
        weakestDay: report.weakestDay || "",
        streak: report.streak || 0,
        score: report.score || 0,
        suggestionsOrForecast: report.suggestionsOrForecast || "",
        createdAt: new Date().toISOString()
      };
      await setDoc(reportRef, newReport)
        .catch(e => handleFirestoreError(e, OperationType.CREATE, `users/${currentUser.id}/analytics/${reportRef.id}`));
      setReports((prev) => [newReport, ...prev]);
      handleUnlockAchievement(
        report.type === "weekly" ? "Weekly Scribe" : "Monthly Architect", 
        `Auto-logged persistent ${report.type} performance statistics to the database!`
      );
      await createNotificationDocuments({
        type: "system",
        title: "Daily Summary Ready",
        message: `Daily performance logged: ${report.completionRate}% completion, streak ${report.streak}, productivity score ${report.score || 0}.`,
      });
    } catch (e) {
      console.error("Error saving report", e);
    }
  };

  const handleLogOut = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error("Error logging out", e);
    }
    setCurrentUser(null);
  };

  if (authInitializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100" id="auth-initializing-wrapper">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Initializing Secure Session...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className={`min-h-screen font-sans transition-colors duration-300 ${
        theme === "dark" ? "bg-slate-950 text-slate-100" : "bg-slate-105 text-slate-900"
      }`} id="auth-root-wrapper">
        <AuthView onLoginSuccess={setCurrentUser} />
      </div>
    );
  }

  return (
    <div className={`min-h-screen font-sans flex flex-col transition-colors duration-300 ${
      theme === "dark" ? "bg-slate-950 text-slate-100" : "bg-slate-50 text-slate-900"
    }`} id="application-container">
      
      {/* Sleek Minimal Header */}
      <header className={`border-b shrink-0 z-30 transition-colors ${
        theme === "dark" ? "border-slate-800 bg-slate-950/80 backdrop-blur" : "border-slate-200 bg-white/80 backdrop-blur"
      }`}>
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-500 shadow-lg shadow-indigo-600/15">
              <BrainCircuit className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-black tracking-tight text-slate-800 dark:text-white leading-none">
                LifeSync AI
              </h1>
              <span className="text-[9px] font-bold text-indigo-500 uppercase tracking-widest mt-0.5 block">
                Recurring Challenges & AI Coach
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            
            {/* Tab selection */}
            <div className="flex gap-1 bg-slate-100 dark:bg-slate-900 p-1 rounded-xl border border-slate-200/50 dark:border-slate-800">
              <button
                onClick={() => setActiveTab("planner")}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                  activeTab === "planner"
                    ? "bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
                id="header-tab-planner"
              >
                <ClipboardList className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Active Challenges</span>
              </button>
              <button
                onClick={() => setActiveTab("analytics")}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                  activeTab === "analytics"
                    ? "bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
                id="header-tab-analytics"
              >
                <Activity className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Analytics & Coach</span>
              </button>
            </div>

            <div className="h-6 w-[1px] bg-slate-200 dark:bg-slate-800 hidden sm:block" />

            {/* Theme Toggle Button */}
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className={`rounded-xl p-2 border transition cursor-pointer ${
                theme === "dark"
                  ? "bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700" 
                  : "bg-slate-100 border-slate-200 text-slate-600 hover:text-black hover:border-slate-300"
              }`}
              title={`Switch to ${theme === "dark" ? "Light" : "Dark"} Mode`}
              id="theme-toggler"
            >
              {theme === "dark" ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
            </button>

            <NotificationBell
              notifications={notifications}
              unreadCount={unreadCount}
              onMarkAsRead={(id) => handleMarkNotifsRead(id)}
              onMarkAllRead={() => handleMarkNotifsRead(undefined, true)}
            />

            {/* Profile widget */}
            <div className="hidden md:flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center font-bold text-xs text-indigo-500 uppercase">
                {currentUser.name.substring(0, 2)}
              </div>
              <div className="text-left leading-none">
                <span className="block text-xs font-black text-slate-800 dark:text-white max-w-[100px] truncate">{currentUser.name}</span>
                <span className="text-[9px] text-slate-400 font-medium truncate max-w-[100px] block mt-0.5">{currentUser.email}</span>
              </div>
            </div>

            {/* Logout */}
            <button
              onClick={handleLogOut}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 font-bold text-xs transition cursor-pointer ${
                theme === "dark"
                  ? "bg-rose-500/10 text-rose-400 border-rose-500/20 hover:bg-rose-500/20"
                  : "bg-rose-50 text-rose-600 border-rose-100 hover:bg-rose-100"
              }`}
              title="Sign Out Session"
              id="session-signout-trigger"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Pane */}
      <main className="flex-1 overflow-y-auto px-4 py-8 max-w-7xl w-full mx-auto" id="application-viewport">
        
        {/* Sync Progress Indication */}
        {loading && (
          <div className="flex items-center justify-center gap-2 p-3 bg-indigo-500/5 text-indigo-500 border border-indigo-500/10 text-xs font-semibold rounded-xl mb-6">
            <span className="h-3 w-3 rounded-full bg-indigo-500 animate-ping" />
            <span>Connecting to live habits vault databases...</span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-3.5 bg-rose-500/10 text-rose-500 border border-rose-500/25 text-xs font-semibold rounded-xl mb-6">
            <AlertCircle className="h-4.5 w-4.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* View switching logic */}
        {activeTab === "planner" ? (
          <PlannerView 
            challenges={challenges}
            logs={logs}
            activeDate={activeDate}
            setActiveDate={setActiveDate}
            onAddChallenge={handleAddChallenge}
            onUpdateLogStatus={handleUpdateLogStatus}
            onDeleteChallenge={handleDeleteChallenge}
            notes={notes}
            goals={goals}
            onSaveNote={handleSaveNote}
            onCreateGoal={handleCreateGoal}
            onToggleGoal={handleToggleGoal}
            onDeleteGoal={handleDeleteGoal}
          />
        ) : (
          <AnalyticsView 
            currentUser={currentUser}
            challenges={challenges}
            logs={logs}
            activeDate={activeDate}
            achievements={achievements}
            notifications={notifications}
            notifSettings={notifSettings}
            reports={reports}
            onUpdateNotifSettings={handleUpdateNotifSettings}
            onMarkNotifsRead={handleMarkNotifsRead}
            onSimulateNotif={handleSimulateNotif}
            onSaveReport={handleSaveReport}
            onUnlockAchievement={handleUnlockAchievement}
          />
        )}
      </main>

      {/* Footer banner */}
      <footer className="mt-auto py-5 border-t border-slate-200/50 dark:border-slate-900 text-center text-[10.5px] text-slate-400 dark:text-slate-500 px-4">
        <span>© 2026 LifeSync AI • Recurring Challenge Orchestrator</span>
      </footer>

    </div>
  );
}
