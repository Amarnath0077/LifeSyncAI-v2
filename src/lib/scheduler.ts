import { doc, getDoc, collection, getDocs, setDoc } from "firebase/firestore";
import { db, auth, handleFirestoreError, OperationType } from "../firebase";
import { NotificationSetting } from "../types";

/**
 * Interface to keep track of triggered schedules during the day
 * to prevent duplicate triggers within the same minute or day.
 */
interface TriggerRecord {
  morning: string | null; // Keeps 'YYYY-MM-DD' when triggered
  evening: string | null;
  eod: string | null;
}

/**
 * Initializes a client-side background email scheduler.
 * Monitors notification_preferences on Firestore for the current user,
 * checking once every 30-60 seconds if the current time matches the defined time slots.
 * 
 * @param userId - The ID of the currently authenticated user
 * @param onTrigger - Optional callback invoked when a notification email is triggered
 * @returns A cleanup function to clear the interval timer
 */
export function initializeEmailSchedulers(
  userId: string,
  onTrigger?: (campaign: "morning" | "evening" | "eod", success: boolean, data?: any) => void
): () => void {
  if (!userId) {
    console.warn("Scheduler initialized without a valid userId.");
    return () => {};
  }

  // Track the last triggered date for each campaign slot:
  const triggered: TriggerRecord = {
    morning: null,
    evening: null,
    eod: null,
  };

  const checkAndTrigger = async () => {
    // Audit-compliant: strictly use auth.currentUser.uid instead of transient offline inputs
    const activeUid = auth.currentUser?.uid || userId;
    try {
      const settingsRef = doc(db, "users", activeUid, "notification_preferences", "settings");
      let settingsSnap;
      try {
        settingsSnap = await getDoc(settingsRef);
      } catch (e) {
        handleFirestoreError(e, OperationType.GET, `users/${activeUid}/notification_preferences/settings`);
        return;
      }

      if (!settingsSnap || !settingsSnap.exists()) {
        return; // No user configuration found yet
      }

      const settings = settingsSnap.data() as NotificationSetting;

      // Ensure notifications and email campaigns are enabled for this user
      if (!settings.emailEnabled) {
        return;
      }

      const now = new Date();
      const todayStr = now.toISOString().split("T")[0]; // YYYY-MM-DD

      // Extract time in HH:MM format for both UTC and Local
      const utcHour = now.getUTCHours().toString().padStart(2, "0");
      const utcMin = now.getUTCMinutes().toString().padStart(2, "0");
      const utcTimeStr = `${utcHour}:${utcMin}`;

      const localHour = now.getHours().toString().padStart(2, "0");
      const localMin = now.getMinutes().toString().padStart(2, "0");
      const localTimeStr = `${localHour}:${localMin}`;

      // Compile user statistic indices from modern Firestore collections directly inside client
      const compileSchedulerUserData = async () => {
        try {
          let userSnap;
          try {
            userSnap = await getDoc(doc(db, "users", activeUid));
          } catch (e) {
            handleFirestoreError(e, OperationType.GET, `users/${activeUid}`);
            throw e;
          }
          const userData = userSnap.exists() ? userSnap.data() : null;
          const emailVal = userData?.email || "";
          const nameVal = userData?.name || "Participant";

          let challengesSnap;
          try {
            challengesSnap = await getDocs(collection(db, "users", activeUid, "challenges"));
          } catch (e) {
            handleFirestoreError(e, OperationType.LIST, `users/${activeUid}/challenges`);
            throw e;
          }
          const userChallenges = challengesSnap.docs.map(d => ({ ...d.data(), id: d.id }));

          let tasksSnap;
          try {
            tasksSnap = await getDocs(collection(db, "users", activeUid, "tasks"));
          } catch (e) {
            handleFirestoreError(e, OperationType.LIST, `users/${activeUid}/tasks`);
            throw e;
          }
          const userLogs = tasksSnap.docs.map(d => ({ ...d.data(), id: d.id }));

          const getStreak = (c: any) => {
            const challengeLogs = userLogs.filter((l: any) => l.challengeId === c.id);
            if (challengeLogs.length === 0) return 0;
            const hasSuccess = (d: string) => {
              const logsForDay = challengeLogs.filter((l: any) => l.date === d);
              if (logsForDay.length === 0) return false;
              return logsForDay.every((l: any) => l.status === "Completed") || logsForDay.some((l: any) => l.status === "Completed" || l.status === "Partial");
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

          const currentStreak = userChallenges.length > 0
            ? Math.max(...userChallenges.map((c: any) => getStreak(c)), 0)
            : 0;

          const todayTasks: Array<{ challengeName: string; taskTitle: string; status: string }> = [];
          userChallenges.forEach((c: any) => {
            (c.dailyTasks || []).forEach((task: string) => {
              const log = userLogs.find((l: any) => l.challengeId === c.id && l.date === todayStr && l.taskTitle === task);
              todayTasks.push({
                challengeName: c.name,
                taskTitle: task,
                status: log ? (log as any).status : "Uncompleted"
              });
            });
          });

          const completedCount = todayTasks.filter((t: any) => t.status === "Completed").length;
          const partialCount = todayTasks.filter((t: any) => t.status === "Partial").length;
          const totalCount = todayTasks.length;
          const completionRate = totalCount > 0 ? Math.round(((completedCount + 0.5 * partialCount) / totalCount) * 100) : 0;

          return {
            name: nameVal,
            email: emailVal,
            streak: currentStreak,
            totalCount,
            completedCount,
            partialCount,
            completionRate,
            todayTasks,
            challenges: userChallenges.map((c: any) => {
              const sDate = new Date(c.startDate);
              const curDate = new Date(todayStr);
              const elapsed = Math.max(1, Math.ceil((curDate.getTime() - sDate.getTime()) / (24*60*60*1000)));
              return {
                name: c.name,
                progressDay: elapsed,
                durationDays: c.durationDays
              };
            })
          };
        } catch (e) {
          console.error("Failed to compile scheduler user data from client side:", e);
          return null;
        }
      };

      // Helper function to invoke the campaign API
      const triggerCampaign = async (campaign: "morning" | "evening" | "eod") => {
        try {
          console.log(`[CLIENT SCHEDULER] Triggering ${campaign} email campaign for user: ${activeUid}`);
          
          let userName = "User";
          let userEmail = "";
          try {
            let userSnap;
            try {
              userSnap = await getDoc(doc(db, "users", activeUid));
            } catch (e) {
              handleFirestoreError(e, OperationType.GET, `users/${activeUid}`);
              throw e;
            }
            if (userSnap.exists()) {
              const ud = userSnap.data();
              userName = ud.name || "User";
              userEmail = ud.email || "";
            }
          } catch (e) {
            console.warn("[CLIENT SCHEDULER] Failed to read user profile:", e);
          }

          const compiledData = await compileSchedulerUserData();

          const res = await fetch("/api/emails/trigger-campaign", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-user-id": activeUid,
            },
            body: JSON.stringify({ 
              userId: activeUid, 
              campaign,
              userName,
              userEmail,
              clientSettings: settings,
              compiledData
            }),
          });

          const data = await res.json();
          if (res.ok) {
            console.log(`[CLIENT SCHEDULER] Success triggering ${campaign}:`, data);
            
            // Client-side saves the log and notifications safely
            if (data.logPayload) {
              try {
                await setDoc(doc(db, "users", activeUid, "email_logs", data.logPayload.id), data.logPayload);
              } catch (logErr) {
                try {
                  handleFirestoreError(logErr, OperationType.CREATE, `users/${activeUid}/email_logs/${data.logPayload.id}`);
                } catch (ignored) {}
                console.error("[CLIENT SCHEDULER] Failed to write log payload to Firestore:", logErr);
              }
            }
            if (data.notifPayload) {
              try {
                await setDoc(doc(db, "users", activeUid, "notifications", data.notifPayload.id), data.notifPayload);
              } catch (notifErr) {
                try {
                  handleFirestoreError(notifErr, OperationType.CREATE, `users/${activeUid}/notifications/${data.notifPayload.id}`);
                } catch (ignored) {}
                console.error("[CLIENT SCHEDULER] Failed to write notification payload to Firestore:", notifErr);
              }
            }

            if (onTrigger) onTrigger(campaign, true, data);
          } else {
            console.error(`[CLIENT SCHEDULER] Error response for ${campaign}:`, data.error);
            if (onTrigger) onTrigger(campaign, false, data);
          }
        } catch (err) {
          console.error(`[CLIENT SCHEDULER] Fetch fail on ${campaign}:`, err);
          if (onTrigger) onTrigger(campaign, false, err);
        }
      };

      // 1. Morning Time Check
      if (
        settings.morningEnabled &&
        settings.morningTime &&
        triggered.morning !== todayStr &&
        (settings.morningTime === utcTimeStr || settings.morningTime === localTimeStr)
      ) {
        triggered.morning = todayStr;
        await triggerCampaign("morning");
      }

      // 2. Evening Time Check
      if (
        settings.eveningEnabled &&
        settings.eveningTime &&
        triggered.evening !== todayStr &&
        (settings.eveningTime === utcTimeStr || settings.eveningTime === localTimeStr)
      ) {
        triggered.evening = todayStr;
        await triggerCampaign("evening");
      }

      // 3. EOD Time Check
      if (
        settings.eodEnabled &&
        settings.eodTime &&
        triggered.eod !== todayStr &&
        (settings.eodTime === utcTimeStr || settings.eodTime === localTimeStr)
      ) {
        triggered.eod = todayStr;
        await triggerCampaign("eod");
      }
    } catch (error) {
      console.error("[CLIENT SCHEDULER] Error running periodic schedule check:", error);
    }
  };

  // Run initial check immediately
  checkAndTrigger();

  // Check every 30 seconds to capture HH:MM accurately and prevent miss due to timer inaccuracy
  const intervalId = setInterval(checkAndTrigger, 30000);

  // Return unsubscribe/cleanup function
  return () => {
    clearInterval(intervalId);
    console.log(`[CLIENT SCHEDULER] Cleaned up scheduler for user: ${userId}`);
  };
}
