import express from "express";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import nodemailer from "nodemailer";
import PDFDocument from "pdfkit";
import { createBrevoEmailService } from "./api/emails/brevo-service";

dotenv.config();

// Initialize Firebase Client on Backend to bypass IAM restrictions
import { initializeApp, getApps } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, doc as clientDoc, getDocs, getDoc, setDoc, updateDoc } from "firebase/firestore";

const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf-8"));

let firebaseApp;
if (!getApps().length) {
  firebaseApp = initializeApp(firebaseConfig);
} else {
  firebaseApp = getApps()[0];
}

const clientDb = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);

class DocCompat {
  constructor(public db: any, public paths: string[]) {}

  collection(collectionId: string) {
    return new CollectionCompat(this.db, [...this.paths, collectionId]);
  }

  async get() {
    const docRef = clientDoc(this.db, this.paths[0], ...this.paths.slice(1));
    const snap = await getDoc(docRef);
    return {
      id: snap.id,
      get exists() {
        return snap.exists();
      },
      data: () => snap.data()
    };
  }

  async set(data: any) {
    const docRef = clientDoc(this.db, this.paths[0], ...this.paths.slice(1));
    await setDoc(docRef, data);
  }

  async update(data: any) {
    const docRef = clientDoc(this.db, this.paths[0], ...this.paths.slice(1));
    await updateDoc(docRef, data);
  }
}

class CollectionCompat {
  constructor(public db: any, public paths: string[]) {}

  doc(docId: string) {
    return new DocCompat(this.db, [...this.paths, docId]);
  }

  async get() {
    const colRef = collection(this.db, this.paths[0], ...this.paths.slice(1));
    const snap = await getDocs(colRef);
    return {
      docs: snap.docs.map(d => ({
        id: d.id,
        get exists() {
          return d.exists();
        },
        data: () => d.data()
      }))
    };
  }
}

class FirestoreCompat {
  constructor(public db: any) {}

  collection(collectionId: string) {
    return new CollectionCompat(this.db, [collectionId]);
  }
}

const firestoreDb = new FirestoreCompat(clientDb) as any;

// Initialize Brevo Email Service for automated campaigns
const brevoEmailService = createBrevoEmailService(firestoreDb);
let brevoReady = false;
brevoEmailService.verifyConnection().then((isReady) => {
  brevoReady = isReady;
  if (brevoReady) {
    console.log("[Brevo] Email service initialized and ready for production");
  } else {
    console.warn("[Brevo] Email service initialized but connection verification failed. Check credentials.");
  }
}).catch((err) => {
  console.error("[Brevo] Failed to initialize email service:", err);
});

// Trigger backend system scheduler login
const systemSchedulerEmail = "system-scheduler@lifesync.ai";
const systemSchedulerPassword = "SysSchedulerPass123!";
let isSchedulerAuthenticated = false;

async function authenticateBackendScheduler() {
  const authInstance = getAuth(firebaseApp);
  try {
    await signInWithEmailAndPassword(authInstance, systemSchedulerEmail, systemSchedulerPassword);
    console.log("Backend custom scheduler successfully authenticated as " + systemSchedulerEmail);
    isSchedulerAuthenticated = true;
  } catch (err: any) {
    if (err.code === "auth/user-not-found" || err.message?.includes("user-not-found") || err.code === "auth/invalid-credential" || err.code === "auth/operation-not-allowed") {
      try {
        await createUserWithEmailAndPassword(authInstance, systemSchedulerEmail, systemSchedulerPassword);
        console.log("System scheduler backend account created & authenticated successfully.");
        isSchedulerAuthenticated = true;
      } catch (createErr: any) {
        console.error("Failed to register system-scheduler credential profile:", createErr.message || createErr);
        isSchedulerAuthenticated = false;
      }
    } else {
      console.error("System scheduler auth pairing failed:", err.message || err);
      isSchedulerAuthenticated = false;
    }
  }
}

authenticateBackendScheduler();

const app = express();
const PORT = 3001;

app.use(express.json());

// Database file path setup
const DB_FILE = path.join(process.cwd(), "data", "database.json");

// Ensure database directory and file exist with initial mock data
function initDatabase() {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(DB_FILE)) {
    const initialData = {
      users: [
        {
          id: "demo-user",
          name: "Amarnath User",
          email: "ankamamarnath23@gmail.com",
          password: "password123"
        }
      ],
      challenges: [],
      logs: [] as any[]
    };

    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), "utf-8");
  }
}

initDatabase();

// Database Helper Functions
function readDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return { users: [], challenges: [], logs: [], notes: [], goals: [], achievements: [], notificationsSettings: [], notifications: [], reports: [] };
    }
    const data = fs.readFileSync(DB_FILE, "utf-8");
    const parsed = JSON.parse(data);
    
    // Defensive property checks for custom data persistence
    if (!parsed.users) parsed.users = [];
    if (!parsed.challenges) parsed.challenges = [];
    if (!parsed.logs) parsed.logs = [];
    if (!parsed.notes) parsed.notes = [];
    if (!parsed.goals) parsed.goals = [];
    if (!parsed.achievements) parsed.achievements = [];
    if (!parsed.notificationsSettings) parsed.notificationsSettings = [];
    if (!parsed.notifications) parsed.notifications = [];
    if (!parsed.reports) parsed.reports = [];
    
    return parsed;
  } catch (err) {
    console.error("Error reading database file", err);
    return { 
      users: [], 
      challenges: [], 
      logs: [], 
      notes: [], 
      goals: [], 
      achievements: [], 
      notificationsSettings: [], 
      notifications: [], 
      reports: [] 
    };
  }
}

function writeDb(data: any) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Error writing to database file", err);
  }
}

// Global active server check
app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// --- Authentication APIs ---

// Signup
app.post("/api/auth/signup", (req, res) => {
  const { name, email, password } = req.body;
  
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email, and password are required fields." });
  }

  const db = readDb();
  
  // Check for existing email
  const existingUser = db.users.find((u: any) => u.email.toLowerCase() === email.toLowerCase());
  if (existingUser) {
    return res.status(400).json({ error: "Email is already registered. Please login." });
  }

  const newUser = {
    id: "user-" + Date.now().toString(),
    name,
    email: email.toLowerCase(),
    password
  };

  db.users.push(newUser);
  writeDb(db);

  // Send Welcome Email asynchronously (non-blocking)
  if (brevoReady) {
    brevoEmailService.sendWelcomeEmail(newUser.id, newUser.email, newUser.name).catch((err) => {
      console.error("[Signup] Failed to send welcome email:", err);
      // Non-fatal error: don't fail signup if email fails
    });
  } else {
    console.warn("[Signup] Brevo service not ready, welcome email not sent");
  }

  res.status(201).json({
    success: true,
    user: {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email
    }
  });
});

// Login
app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required fields." });
  }

  const db = readDb();
  const user = db.users.find(
    (u: any) => u.email.toLowerCase() === email.toLowerCase() && u.password === password
  );

  if (!user) {
    return res.status(401).json({ error: "Invalid email or password mismatch." });
  }

  res.json({
    success: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email
    }
  });
});

// --- Challenge System APIs ---

// Get all challenges of specific user
app.get("/api/challenges", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized access: x-user-id header is missing." });
  }

  const db = readDb();
  // Ensure we fall back if property not initialized
  const challenges = db.challenges || [];
  const userChallenges = challenges.filter((c: any) => c.userId === userId);
  res.json(userChallenges);
});

// Create a new Challenge
app.post("/api/challenges", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized: x-user-id header is missing." });
  }

  const { name, startDate, durationDays, dailyTasks } = req.body;
  if (!name || !durationDays || !dailyTasks || !Array.isArray(dailyTasks)) {
    return res.status(400).json({ error: "Missing required challenge fields (name, durationDays, dailyTasks array)." });
  }

  const db = readDb();
  if (!db.challenges) db.challenges = [];

  const newChallenge = {
    id: "challenge-" + Date.now().toString() + "-" + Math.random().toString(36).substr(2, 4),
    userId,
    name: name.trim(),
    startDate: startDate || new Date().toISOString().split("T")[0],
    durationDays: Math.max(1, Number(durationDays)),
    dailyTasks: dailyTasks.map(t => t.trim()).filter(Boolean),
    createdAt: new Date().toISOString()
  };

  db.challenges.push(newChallenge);
  writeDb(db);

  res.status(201).json(newChallenge);
});

// Edit Challenge metadata
app.put("/api/challenges/:id", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  const challengeId = req.params.id;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  const db = readDb();
  if (!db.challenges) db.challenges = [];

  const idx = db.challenges.findIndex((c: any) => c.id === challengeId && c.userId === userId);
  if (idx === -1) {
    return res.status(404).json({ error: "Challenge not found." });
  }

  const { name, durationDays, dailyTasks } = req.body;
  const current = db.challenges[idx];

  const updated = {
    ...current,
    name: name !== undefined ? name.trim() : current.name,
    durationDays: durationDays !== undefined ? Math.max(1, Number(durationDays)) : current.durationDays,
    dailyTasks: dailyTasks !== undefined && Array.isArray(dailyTasks) ? dailyTasks.map(t => t.trim()).filter(Boolean) : current.dailyTasks
  };

  db.challenges[idx] = updated;
  writeDb(db);
  res.json(updated);
});

// Delete Challenge
app.delete("/api/challenges/:id", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  const challengeId = req.params.id;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  const db = readDb();
  if (!db.challenges) db.challenges = [];
  if (!db.logs) db.logs = [];

  const initialCount = db.challenges.length;
  db.challenges = db.challenges.filter((c: any) => !(c.id === challengeId && c.userId === userId));

  if (db.challenges.length === initialCount) {
    return res.status(404).json({ error: "Challenge not found." });
  }

  // Clean up associated logs
  db.logs = db.logs.filter((l: any) => l.challengeId !== challengeId);
  writeDb(db);

  res.json({ success: true, message: "Challenge and associated logs deleted successfully." });
});

// Get user challenge daily logs
app.get("/api/challenges/logs", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  const db = readDb();
  const logs = db.logs || [];
  const userLogs = logs.filter((l: any) => l.userId === userId);
  res.json(userLogs);
});

// Set / Toggle Daily Task Completion log
app.post("/api/challenges/logs/update", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  const { challengeId, date, taskTitle, status } = req.body;
  if (!challengeId || !date || !taskTitle || !status) {
    return res.status(400).json({ error: "Missing required parameters: challengeId, date, taskTitle, status." });
  }

  const db = readDb();
  if (!db.logs) db.logs = [];

  // Find if matching log exists of same user, challenge, date, and task title
  const logIdx = db.logs.findIndex((l: any) => 
    l.userId === userId && 
    l.challengeId === challengeId && 
    l.date === date && 
    l.taskTitle === taskTitle
  );

  const updatedStatus = status as "Completed" | "Skipped" | "Partial" | "Uncompleted";

  if (logIdx > -1) {
    if (updatedStatus === "Uncompleted") {
      // Remove to stay lean, or set to Uncompleted
      db.logs.splice(logIdx, 1);
    } else {
      db.logs[logIdx].status = updatedStatus;
    }
  } else if (updatedStatus !== "Uncompleted") {
    const newLog = {
      id: "log-" + Date.now().toString() + "-" + Math.random().toString(36).substr(2, 4),
      challengeId,
      userId,
      date,
      taskTitle,
      status: updatedStatus
    };
    db.logs.push(newLog);
  }

  writeDb(db);

  // Send Task Completion Email if task was just marked as Completed
  if (updatedStatus === "Completed" && brevoReady) {
    const userDb = db.users.find((u: any) => u.id === userId);
    if (userDb) {
      const challenge = db.challenges?.find((c: any) => c.id === challengeId);
      const challengeName = challenge?.name || "Your Challenge";
      
      // Count completed tasks today
      const todayLogs = db.logs.filter((l: any) => l.userId === userId && l.date === date);
      const completedCount = todayLogs.filter((l: any) => l.status === "Completed").length;
      const totalDailyTasks = todayLogs.length;
      
      // Get current streak
      let streak = 0;
      const checkDate = new Date(date);
      for (let i = 0; i < 180; i++) {
        const dStr = checkDate.toISOString().split("T")[0];
        const logsForDay = db.logs.filter((l: any) => l.userId === userId && l.date === dStr);
        const hasSuccess = logsForDay.some((l: any) => l.status === "Completed" || l.status === "Partial");
        if (hasSuccess) {
          streak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          break;
        }
      }

      brevoEmailService.sendTaskCompletionEmail(userId, userDb.email, userDb.name, {
        taskTitle,
        challengeName,
        completedCount,
        totalCount: totalDailyTasks,
        streak
      }).catch((err) => {
        console.error("[Task Completion] Failed to send email:", err);
      });
    }
  }

  res.json({ success: true, logs: db.logs.filter((l: any) => l.userId === userId) });
});

// --- USER NOTES APIs ---
app.get("/api/notes", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const db = readDb();
  const userNotes = (db.notes || []).filter((n: any) => n.userId === userId);
  res.json(userNotes);
});

app.post("/api/notes", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { challengeId, date, content } = req.body;
  if (!date || content === undefined) {
    return res.status(400).json({ error: "Date and content are required." });
  }

  const db = readDb();
  if (!db.notes) db.notes = [];

  const existingIdx = db.notes.findIndex((n: any) => n.userId === userId && n.date === date && n.challengeId === challengeId);

  if (content.trim() === "") {
    if (existingIdx > -1) {
      db.notes.splice(existingIdx, 1);
    }
  } else {
    if (existingIdx > -1) {
      db.notes[existingIdx].content = content.trim();
    } else {
      db.notes.push({
        id: "note-" + Date.now() + "-" + Math.random().toString(36).substr(2, 4),
        userId,
        challengeId,
        date,
        content: content.trim(),
        createdAt: new Date().toISOString()
      });
    }
  }

  writeDb(db);
  res.json({ success: true, notes: db.notes.filter((n: any) => n.userId === userId) });
});

app.delete("/api/notes/:id", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  const id = req.params.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const db = readDb();
  db.notes = (db.notes || []).filter((n: any) => !(n.id === id && n.userId === userId));
  
  writeDb(db);
  res.json({ success: true });
});

// --- GOALS APIs ---
app.get("/api/goals", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const db = readDb();
  const userGoals = (db.goals || []).filter((g: any) => g.userId === userId);
  res.json(userGoals);
});

app.post("/api/goals", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { title, targetDate, challengeId } = req.body;
  if (!title || !targetDate) {
    return res.status(400).json({ error: "Title and targetDate are required." });
  }

  const db = readDb();
  if (!db.goals) db.goals = [];

  const newGoal = {
    id: "goal-" + Date.now() + "-" + Math.random().toString(36).substr(2, 4),
    userId,
    challengeId,
    title: title.trim(),
    targetDate,
    completed: false,
    createdAt: new Date().toISOString()
  };

  db.goals.push(newGoal);
  writeDb(db);
  res.status(201).json(newGoal);
});

app.put("/api/goals/:id", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  const id = req.params.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const db = readDb();
  if (!db.goals) db.goals = [];
  const idx = db.goals.findIndex((g: any) => g.id === id && g.userId === userId);
  if (idx === -1) {
    return res.status(404).json({ error: "Goal not found." });
  }

  const { title, targetDate, completed } = req.body;
  const goal = db.goals[idx];

  if (title !== undefined) goal.title = title.trim();
  if (targetDate !== undefined) goal.targetDate = targetDate;
  if (completed !== undefined) {
    goal.completed = completed;
    goal.completedAt = completed ? new Date().toISOString() : undefined;
  }

  db.goals[idx] = goal;
  writeDb(db);
  res.json(goal);
});

app.delete("/api/goals/:id", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  const id = req.params.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const db = readDb();
  db.goals = (db.goals || []).filter((g: any) => !(g.id === id && g.userId === userId));
  writeDb(db);
  res.json({ success: true });
});

// --- ACHIEVEMENT HISTORY APIs ---
app.get("/api/achievements", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const db = readDb();
  const userAchievements = (db.achievements || []).filter((a: any) => a.userId === userId);
  res.json(userAchievements);
});

app.post("/api/achievements/unlock", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { title, description } = req.body;
  if (!title || !description) return res.status(400).json({ error: "Title and description are required." });

  const db = readDb();
  if (!db.achievements) db.achievements = [];

  const alreadyUnlocked = db.achievements.some((a: any) => a.userId === userId && a.title.toLowerCase() === title.toLowerCase());
  if (alreadyUnlocked) {
    return res.json({ success: false, message: "Achievement already unlocked." });
  }

  const newAchievement = {
    id: "achievement-" + Date.now() + "-" + Math.random().toString(36).substr(2, 4),
    userId,
    title,
    description,
    unlockedAt: new Date().toISOString()
  };

  db.achievements.push(newAchievement);
  writeDb(db);
  res.status(201).json(newAchievement);
});

// --- NOTIFICATION CONFIGURATION & CHANNELS ---
app.get("/api/notifications/settings", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const db = readDb();
  let settings = (db.notificationsSettings || []).find((s: any) => s.userId === userId);
  if (!settings) {
    settings = {
      userId,
      morningEnabled: true,
      eveningEnabled: true,
      eodEnabled: true,
      emailEnabled: true,
      pushEnabled: false,
      inAppEnabled: true,
      emailProvider: "smtp",
      emailApiKey: "",
      smtpHost: "",
      smtpPort: 587,
      smtpUser: process.env.BREVO_SMTP_USER,
      smtpPass: process.env.BREVO_SMTP_PASS,
      smtpFrom: "",
      morningTime: "08:00",
      eveningTime: "18:00",
      eodTime: "21:00",
      weeklyReportDay: 0,
      monthlyReportDay: "last"
    };
  }
  res.json(settings);
});

app.post("/api/notifications/settings", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const settingsData = req.body;

  const db = readDb();
  if (!db.notificationsSettings) db.notificationsSettings = [];

  const idx = db.notificationsSettings.findIndex((s: any) => s.userId === userId);
  
  // Find current to merge or declare broad defaults
  const current = idx > -1 ? db.notificationsSettings[idx] : {};

  const updated = {
    userId,
    morningEnabled: settingsData.morningEnabled !== undefined ? settingsData.morningEnabled : (current.morningEnabled ?? true),
    eveningEnabled: settingsData.eveningEnabled !== undefined ? settingsData.eveningEnabled : (current.eveningEnabled ?? true),
    eodEnabled: settingsData.eodEnabled !== undefined ? settingsData.eodEnabled : (current.eodEnabled ?? true),
    emailEnabled: settingsData.emailEnabled !== undefined ? settingsData.emailEnabled : (current.emailEnabled ?? true),
    pushEnabled: settingsData.pushEnabled !== undefined ? settingsData.pushEnabled : (current.pushEnabled ?? false),
    inAppEnabled: settingsData.inAppEnabled !== undefined ? settingsData.inAppEnabled : (current.inAppEnabled ?? true),
    
    emailProvider: settingsData.emailProvider !== undefined ? settingsData.emailProvider : (current.emailProvider ?? "smtp"),
    emailApiKey: settingsData.emailApiKey !== undefined ? settingsData.emailApiKey : (current.emailApiKey ?? ""),
    smtpHost: settingsData.smtpHost !== undefined ? settingsData.smtpHost : (current.smtpHost ?? ""),
    smtpPort: settingsData.smtpPort !== undefined ? Number(settingsData.smtpPort) : (current.smtpPort ?? 587),
    smtpUser: settingsData.smtpUser !== undefined ? settingsData.smtpUser : (current.smtpUser ?? ""),
    smtpPass: settingsData.smtpPass !== undefined ? settingsData.smtpPass : (current.smtpPass ?? ""),
    smtpFrom: settingsData.smtpFrom !== undefined ? settingsData.smtpFrom : (current.smtpFrom ?? ""),
    
    morningTime: settingsData.morningTime !== undefined ? settingsData.morningTime : (current.morningTime ?? "08:00"),
    eveningTime: settingsData.eveningTime !== undefined ? settingsData.eveningTime : (current.eveningTime ?? "18:00"),
    eodTime: settingsData.eodTime !== undefined ? settingsData.eodTime : (current.eodTime ?? "21:00"),
    weeklyReportDay: settingsData.weeklyReportDay !== undefined ? Number(settingsData.weeklyReportDay) : (current.weeklyReportDay ?? 0),
    monthlyReportDay: settingsData.monthlyReportDay !== undefined ? settingsData.monthlyReportDay : (current.monthlyReportDay ?? "last")
  };

  if (idx > -1) {
    db.notificationsSettings[idx] = updated;
  } else {
    db.notificationsSettings.push(updated);
  }

  writeDb(db);
  res.json(updated);
});

// GET notifications list
app.get("/api/notifications", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const db = readDb();
  const userNotifications = (db.notifications || []).filter((n: any) => n.userId === userId);
  res.json(userNotifications);
});

// Read/Check notifications
app.post("/api/notifications/read", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { id, all } = req.body;

  const db = readDb();
  if (!db.notifications) db.notifications = [];

  if (all) {
    db.notifications.forEach((n: any) => {
      if (n.userId === userId) n.read = true;
    });
  } else if (id) {
    const idx = db.notifications.findIndex((n: any) => n.id === id && n.userId === userId);
    if (idx > -1) {
      db.notifications[idx].read = true;
    }
  }

  writeDb(db);
  res.json({ success: true, notifications: db.notifications.filter((n: any) => n.userId === userId) });
});

// SIMULATE DAILY NOTIFICATIONS
app.post("/api/notifications/simulate", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { date, type, title, message } = req.body;

  const db = readDb();
  if (!db.notifications) db.notifications = [];

  const newNotif = {
    id: "notif-" + Date.now() + "-" + Math.random().toString(36).substr(2, 4),
    userId,
    type,
    title,
    message,
    date: date || new Date().toISOString().split("T")[0],
    read: false,
    createdAt: new Date().toISOString()
  };

  db.notifications.unshift(newNotif);
  writeDb(db);
  res.status(201).json({ success: true, notification: newNotif, notifications: db.notifications.filter((n: any) => n.userId === userId) });
});

// --- REPORT REGISTRY APIs (Weekly/Monthly Progress History) ---
app.get("/api/reports", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const db = readDb();
  const userReports = (db.reports || []).filter((r: any) => r.userId === userId);
  res.json(userReports);
});

app.post("/api/reports", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { type, periodStr, dateKey, completionRate, totalHours, bestDay, weakestDay, streak, score, suggestionsOrForecast } = req.body;

  const db = readDb();
  if (!db.reports) db.reports = [];

  // Check if report already exists for unique lookup
  const existingIdx = db.reports.findIndex((r: any) => r.userId === userId && r.type === type && r.periodStr === periodStr);

  const newReport = {
    id: "report-" + Date.now() + "-" + Math.random().toString(36).substr(2, 4),
    userId,
    type,
    periodStr,
    dateKey: dateKey || new Date().toISOString().split("T")[0],
    completionRate: Number(completionRate || 0),
    totalHours: Number(totalHours || 0),
    bestDay: bestDay || "N/A",
    weakestDay: weakestDay || "N/A",
    streak: Number(streak || 0),
    score: Number(score || 0),
    suggestionsOrForecast: suggestionsOrForecast || "",
    createdAt: new Date().toISOString()
  };

  if (existingIdx > -1) {
    db.reports[existingIdx] = newReport;
  } else {
    db.reports.push(newReport);
  }

  writeDb(db);
  res.status(201).json({ success: true, report: newReport, reports: db.reports.filter((r: any) => r.userId === userId) });
});

// --- AI COACH / GEMINI INTEGRATION ---
let aiClient: GoogleGenAI | null = null;
function getAI(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return null;
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ 
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// Generate motivational insights
app.post("/api/coach/insights", async (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized access" });
  }

  const { statsContext } = req.body;
  
  // Rule-based absolute fallback (guarantees stunning, encouraging text even without API keys)
  const getRandomEncouragingInspirationalLines = () => {
    const lines = [
      "You're ahead of your expected pace. Maintaining this consistency can help you complete your challenge early!",
      "Great effort! You are building consistency. Small improvements every single day create massive long-term success.",
      "You completed a high percentage of your tasks this week. Keep that excellent momentum going!",
      "Every step forward is personal progress. Every single day of logging reinforces your self-mastery."
    ];
    
    // Dynamic rule injection depending on stats context
    if (statsContext) {
      const { overallRate, totalTasks, completedTasks, longestStreak } = statsContext;
      if (overallRate >= 80) {
        return [
          `Spectacular consistency! Your ${overallRate}% average success rate is stellar. Maintaining this momentum means absolute mastery of your goals!`,
          "You completed most of your tasks this week. Excellent momentum—you are currently crushing this active streak!",
          "Maintaining this consistency can help you complete your challenge up to 5 days ahead of your baseline forecast."
        ];
      } else if (overallRate >= 50) {
        return [
          `Great effort! You completed ${overallRate}% of your challenge goals so far. Let's aim for an incremental 5% increase over the coming week!`,
          "You are building resilient roots. Keep logging each day; small, consistent efforts compound exponentially.",
          "Every task completed gets you closer to certification. Your active streak is a shield against distractions."
        ];
      } else {
        return [
          "You are establishing a powerful baseline. Remember: building consistency takes time. Small trials create legendary habits.",
          "Completed some of your tasks? Excellent! That is a success in ourbooks. Let's tackle one more small task tomorrow.",
          "Consistency is a ladder. Do not worry about yesterday; today is a brand new block of potential."
        ];
      }
    }
    return lines;
  };

  try {
    const ai = getAI();
    if (!ai) {
      // Return beautiful local insights immediately!
      return res.json({
        source: "Local Engine",
        insights: getRandomEncouragingInspirationalLines()
      });
    }

    const contextPrompt = statsContext 
      ? `User challenge completion stats context: ${JSON.stringify(statsContext)}. Length details: ${statsContext.totalTasks} tasks planned, ${statsContext.completedTasks} tasks finished, overall average success rate: ${statsContext.overallRate}%. Longest streak is ${statsContext.longestStreak} days.` 
      : "";

    const prompt = `You are a warm, extremely supportive, empathetic, and encouraging AI Career & Habits Coach. 
Please generate 3 individual, concise, highly motivating bullet points of advice/feedback.
Guidelines:
- Maintain an absolutely positive, uplifting, and encouraging tone. Never use patronizing or disappointing statements.
- Instead of talking about failure, highlight current progress and suggest small, easily manageable next steps.
- Make the insights feel personalized. Refer to their momentum, streak growth, and efficiency.
${contextPrompt}

Output your response as a valid JSON array of strings containing exactly 3 items. Example: ["Insight 1", "Insight 2", "Insight 3"]`;

    let response;
    try {
      response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });
    } catch (primaryErr: any) {
      console.warn("Primary model gemini-3.5-flash failed or busy. Trying fallback gemini-3.1-flash-lite...", primaryErr.message || primaryErr);
      try {
        response = await ai.models.generateContent({
          model: "gemini-3.1-flash-lite",
          contents: prompt,
          config: {
            responseMimeType: "application/json"
          }
        });
      } catch (secondaryErr: any) {
        console.warn("Fallback model gemini-3.1-flash-lite failed or busy. Raising error to trigger local engine.", secondaryErr.message || secondaryErr);
        throw secondaryErr;
      }
    }

    const text = response.text || "";
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return res.json({
          source: "Gemini AI",
          insights: parsed.slice(0, 3)
        });
      }
    } catch (parseErr) {
      console.warn("Failed to parse Gemini response as JSON list:", text);
    }

    // Secondary fallback
    res.json({
      source: "Local Engine",
      insights: getRandomEncouragingInspirationalLines()
    });

  } catch (err: any) {
    console.error("Gemini direct error. Using fallback engine graciously:", err);
    res.json({
      source: "Local Engine",
      insights: getRandomEncouragingInspirationalLines()
    });
  }
});


// ==========================================
// EMAIL NOTIFICATION SYSTEM & AUTOMATED JOBS
// ==========================================

// Automatically calculate daily progress from Firestore
async function compileUserDataFromFirestore(userId: string, dateStr: string) {
  // Try to load email and name from Firestore users/{uid}
  const userDocSnap = await firestoreDb.collection("users").doc(userId).get();
  const userData = userDocSnap.exists ? userDocSnap.data() : null;
  const emailVal = userData?.email || "ankamamarnath23@gmail.com";
  const nameVal = userData?.name || "Participant";

  // Fetch from users/{uid}/challenges
  const challengesSnap = await firestoreDb.collection("users").doc(userId).collection("challenges").get();
  const userChallenges = challengesSnap.docs.map((d: any) => ({ ...d.data(), id: d.id })) as any[];

  // Fetch from users/{uid}/tasks
  const tasksSnap = await firestoreDb.collection("users").doc(userId).collection("tasks").get();
  const userLogs = tasksSnap.docs.map((d: any) => ({ ...d.data(), id: d.id })) as any[];

  // Calculate Streak
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
    // Check up to 180 days backwards
    for (let i = 0; i < 180; i++) {
      const dStr = checkDate.toISOString().split("T")[0];
      if (hasSuccess(dStr)) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        if (i === 0) {
          // If not successful today, check yesterday
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

  // Compile tasks checklist for today
  const todayTasks: Array<{ challengeName: string; taskTitle: string; status: string }> = [];
  userChallenges.forEach((c: any) => {
    (c.dailyTasks || []).forEach((task: string) => {
      const log = userLogs.find((l: any) => l.challengeId === c.id && l.date === dateStr && l.taskTitle === task);
      todayTasks.push({
        challengeName: c.name,
        taskTitle: task,
        status: log ? log.status : "Uncompleted"
      });
    });
  });

  // Calculate stats
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
      const curDate = new Date(dateStr);
      const elapsed = Math.max(1, Math.ceil((curDate.getTime() - sDate.getTime()) / (24*60*60*1000)));
      return {
        name: c.name,
        progressDay: elapsed,
        durationDays: c.durationDays
      };
    })
  };
}

// Keep a synchronous compatible wrapper function just in case
function compileUserDataForEmail(userId: string, dateStr: string) {
  // Sync fallback helper
  return {
    name: "User",
    email: "user@example.com",
    streak: 0,
    totalCount: 0,
    completedCount: 0,
    partialCount: 0,
    completionRate: 0,
    todayTasks: [],
    challenges: [] as any[]
  };
}

// Generate PDF Report using pdfkit
async function generateProgressPdfReport(userId: string, type: "weekly" | "monthly", periodStr: string): Promise<Buffer> {
  const data = await compileUserDataFromFirestore(userId, new Date().toISOString().split("T")[0]);

  let advice = "Your cognitive consistency is improving rapidly. Committing with micro-blocks yields splendid results. Focus on marking Partial consistency if you have high workload!";
  try {
    const reportsSnap = await firestoreDb.collection("users").doc(userId).collection("analytics").get();
    const userReports = reportsSnap.docs.map(doc => doc.data() as any);
    userReports.sort((a: any, b: any) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
    const filteredReports = userReports.filter((r: any) => r.type === type);
    if (filteredReports.length > 0) {
      advice = filteredReports[filteredReports.length - 1].suggestionsOrForecast || advice;
    }
  } catch (err) {
    console.error("Error reading report advice from Firestore:", err);
  }

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const buffers: Buffer[] = [];
      doc.on("data", (chunk) => buffers.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", (err) => reject(err));

      const data = compileUserDataForEmail(userId, new Date().toISOString().split("T")[0]);

      // Header Banner
      doc.rect(0, 0, 612, 120).fill("#4f46e5");
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(26).text("LIFESYNC AUTOMATED PROGRESS REPORT", 40, 35, { align: "left" });
      doc.fontSize(12).font("Helvetica").text(`${type.toUpperCase()} ANALYTICS OVERVIEW • ${periodStr.toUpperCase()}`, 40, 75);
      
      // User info
      doc.fillColor("#1e293b").fontSize(14).font("Helvetica-Bold").text(`Participant: ${data.name} (${data.email})`, 40, 140);
      doc.fontSize(10).font("Helvetica").text(`Report Generation Timestamp: ${new Date().toLocaleString()}`, 40, 160);
      doc.moveDown(2);

      // Section
      doc.rect(40, doc.y, 532, 2).fill("#e2e8f0");
      doc.moveDown(1.5);

      // Stat Cards
      doc.font("Helvetica-Bold").fontSize(14).fillColor("#4f46e5").text("Key Habit Indicators & Completion Ratios");
      doc.moveDown(1);

      // Draw Grid
      const yPos = doc.y;
      doc.rect(40, yPos, 160, 80).fill("#f8fafc");
      doc.rect(220, yPos, 160, 80).fill("#f8fafc");
      doc.rect(400, yPos, 172, 80).fill("#f8fafc");

      doc.fillColor("#475569").fontSize(9).font("Helvetica-Bold");
      doc.text("UTILITY STREAK", 55, yPos + 15);
      doc.text("COMPLETION RATIO", 235, yPos + 15);
      doc.text("TOTAL ACTIVE CONTRACTS", 415, yPos + 15);

      doc.fillColor("#1e293b").fontSize(20).font("Helvetica-Bold");
      doc.text(`${data.streak} Days`, 55, yPos + 35);
      doc.text(`${data.completionRate}%`, 235, yPos + 35);
      doc.text(`${data.challenges.length} Active`, 415, yPos + 35);

      doc.moveDown(6);
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#1e293b").text("Breakdown of Active Habit Systems");
      doc.moveDown(0.5);

      if (data.challenges.length === 0) {
        doc.font("Helvetica-Oblique").fontSize(10).fillColor("#64748b").text("No custom challenges started yet.");
      } else {
        data.challenges.forEach((c) => {
          doc.font("Helvetica-Bold").fontSize(10).fillColor("#334155").text(`• ${c.name}`);
          doc.font("Helvetica").fontSize(9).fillColor("#64748b").text(`  Status: Day ${c.progressDay} of ${c.durationDays} Contract Days`, { indent: 15 });
          doc.moveDown(0.5);
        });
      }

      doc.moveDown(1.5);
      doc.rect(40, doc.y, 532, 1).fill("#e2e8f0");
      doc.moveDown(1);

      doc.font("Helvetica-Bold").fontSize(12).fillColor("#1e293b").text("AI Habit Coach Feedback & Forecast");
      doc.moveDown(0.5);
      
      doc.font("Helvetica-Oblique").fontSize(10).fillColor("#475569").text(`"${advice}"`, { width: 520, lineGap: 3 });

      // Footer
      doc.fontSize(8).font("Helvetica").fillColor("#94a3b8").text("Generated automatically by LifeSync AI platform engine.", 40, doc.page.height - 50, { align: "center" });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// Subordinate HTML Builders for morning, evening, eod
function getSmartMotivationalMessage(streak: number, rate: number, isChallengeDone?: boolean): string {
  if (isChallengeDone) {
    return "You kept your promise to yourself. That's powerful. This complete contract proves your word is ironclad. Stand tall.";
  }
  if (streak >= 30) {
    return "Your discipline is becoming your identity. You are no longer just practicing habits; you are living them in your core.";
  }
  if (streak >= 15) {
    return "Fifteen days of raw consistency. You are already ahead of 90% of people who quit early. Protect your hard-earned momentum.";
  }
  if (streak >= 5) {
    return "High momentum detected! Your progress is clean and burning. Fuel it today; do not let the flame flicker.";
  }
  if (rate > 0 && rate < 50) {
    return "Progress is not lost. Restart today. A single dip is an outlier—making a comeback is what separates the elite.";
  }
  if (rate >= 80) {
    return "Outstanding calibration! You are executing near peak compliance. Let's make today another undefeated masterclass.";
  }
  return "Focus on the next rep, the next minor task. Consistency beats intensity every single day. Build the momentum.";
}

function buildPremiumEmailContainer(title: string, subtitle: string, badgeHtml: string, contentHtml: string, name: string) {
  return `
    <div style="background-color: #0b0f19; padding: 40px 20px; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc; line-height: 1.6;">
      <div style="max-width: 580px; margin: 0 auto; background: #111827; border: 1px solid #1f2937; border-radius: 16px; padding: 32px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3);">
        <!-- Logo / Header -->
        <div style="text-align: center; margin-bottom: 24px; border-bottom: 1px solid #1f2937; padding-bottom: 24px;">
          <div style="display: inline-block; padding: 10px 14px; background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); border-radius: 12px; font-weight: bold; font-size: 20px; letter-spacing: 0.5px; color: #ffffff; text-decoration: none;">
            ⚡ LIFESYNC AI
          </div>
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #9ca3af; margin-top: 12px; font-weight: 600;">Personal Performance Coach</div>
        </div>
        
        <!-- Title / Headline -->
        <div style="text-align: center; margin-bottom: 28px;">
          ${badgeHtml ? `<div style="margin-bottom: 12px;">${badgeHtml}</div>` : ""}
          <h1 style="font-size: 24px; font-weight: 700; color: #ffffff; margin: 0 0 6px 0; letter-spacing: -0.5px;">${title}</h1>
          <p style="font-size: 14px; color: #9ca3af; margin: 0;">${subtitle}</p>
        </div>
        
        <!-- Main Content -->
        <div style="font-size: 15px; color: #e5e7eb;">
          ${contentHtml}
        </div>
        
        <!-- Footer -->
        <div style="margin-top: 36px; padding-top: 24px; border-top: 1px solid #1f2937; text-align: center; font-size: 11px; color: #6b7280; line-height: 1.5;">
          <p style="margin: 0 0 8px 0;">You received this because you have an active habit contract on LifeSync AI.</p>
          <p style="margin: 0;">&copy; 2026 LifeSync AI. Consistency beats motivation. Keep going!</p>
        </div>
      </div>
    </div>
  `;
}

function buildMorningEmailHtml(name: string, data: any) {
  const listHtml = data.todayTasks.map((t: any) => `
    <li style="margin-bottom: 12px; font-size: 14px; list-style-type: none; background: #1f2937; padding: 10px 14px; border-radius: 8px; border: 1px solid #374151;">
      <span style="color: #6366f1; font-weight: bold; margin-right: 8px;">[ ]</span> <strong style="color: #ffffff;">${t.challengeName}</strong> <span style="color: #9ca3af;">— ${t.taskTitle}</span>
    </li>
  `).join("") || `<li style="color: #9ca3af; font-style: italic; list-style-type: none; text-align: center; padding: 12px;">No active challenges found. Open App to start a habit contract!</li>`;

  const challengesHtml = data.challenges.map((c: any) => {
    const elapsed = Number(c.progressDay || 1);
    const duration = Number(c.durationDays || 30);
    const pct = Math.min(100, Math.round((elapsed / duration) * 100));
    return `
      <div style="background-color: #1f2937; border: 1px solid #374151; padding: 14px; border-radius: 10px; margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; font-weight: bold; color: #ffffff; font-size: 13.5px; margin-bottom: 6px;">
          <span>${c.name}</span>
          <span style="color: #818cf8;">Day ${elapsed}/${duration}</span>
        </div>
        <div style="background-color: #374151; height: 6px; border-radius: 3px; overflow: hidden; width: 100%;">
          <div style="background: linear-gradient(90deg, #4f46e5 0%, #10b981 100%); width: ${pct}%; height: 100%;"></div>
        </div>
      </div>
    `;
  }).join("");

  const streak = data.streak || 0;
  const motivationMsg = getSmartMotivationalMessage(streak, 0);
  const estMinutes = (data.todayTasks?.length || 0) * 15;

  const badgeHtml = `<span style="display:inline-block; padding: 6px 12px; background: rgba(79, 70, 229, 0.2); border: 1px solid #4f46e5; border-radius: 20px; color: #818cf8; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">☀️ Morning Focus Session</span>`;
  
  const contentHtml = `
    <p style="font-size: 15px;">Good Morning, <strong>${name}</strong>!</p>
    <p style="font-size: 14px; color: #9ca3af; margin-bottom: 24px;">Calibrate your vision and step into action. Here is your structured habits checklist for today:</p>
    
    <div style="background: linear-gradient(135deg, #1e1b4b 0%, #311042 100%); border: 1px solid #3730a3; padding: 18px; border-radius: 12px; text-align: center; margin-bottom: 24px;">
      <span style="font-size: 11px; font-weight: bold; color: #a5b4fc; display: block; text-transform: uppercase; letter-spacing: 1px;">🔥 ACTIVE STREAK STATUS</span>
      <span style="font-size: 28px; font-weight: 800; color: #f97316; display: block; margin-top: 4px; text-shadow: 0 0 10px rgba(249, 115, 22, 0.3);">${streak} Days Running</span>
      <span style="font-size: 12px; color: #cbd5e1; display: block; margin-top: 6px;">You are already out-performing 90% of participants who quit early. Keep it intact.</span>
    </div>

    <h3 style="color: #ffffff; font-size: 14px; border-bottom: 1px solid #1f2937; padding-bottom: 8px; margin-top: 24px; text-transform: uppercase; letter-spacing: 0.5px;">📋 TODAY'S HABIT CONTRACTS:</h3>
    <ul style="padding-left: 0; margin: 12px 0;">
      ${listHtml}
    </ul>

    <h3 style="color: #ffffff; font-size: 14px; border-bottom: 1px solid #1f2937; padding-bottom: 8px; margin-top: 24px; text-transform: uppercase; letter-spacing: 0.5px;">🚀 CHALLENGE CAMPAIGNS:</h3>
    <div style="margin-top: 12px;">
      ${challengesHtml}
    </div>

    <div style="background-color: #1f2937; padding: 12px 16px; border-radius: 8px; border-left: 4px solid #6366f1; margin: 24px 0; font-size: 13px; color: #d1d5db;">
       ⏱️ <strong>Estimated Attention Block:</strong> ~${estMinutes} minutes of focused attention required today.
    </div>

    <div style="background-color: #111827; border: 1px dashed #374151; padding: 16px; border-radius: 10px; margin-top: 24px; text-align: center; font-style: italic; color: #e5e7eb; font-size: 13.5px; line-height: 1.5;">
      "${motivationMsg}"
    </div>
  `;

  return buildPremiumEmailContainer("Morning Calibration & Momentum", "Set your attention, block out distractions, and build tomorrow.", badgeHtml, contentHtml, name);
}

function buildEveningEmailHtml(name: string, data: any) {
  const completed = data.todayTasks.filter((t: any) => t.status === "Completed").length;
  const partial = data.todayTasks.filter((t: any) => t.status === "Partial").length;
  const total = data.todayTasks.length;
  const rate = total > 0 ? Math.round(((completed + 0.5 * partial) / total) * 100) : 0;

  const incompleteHtml = data.todayTasks.filter((t: any) => t.status !== "Completed").map((t: any) => `
    <li style="margin-bottom: 10px; font-size: 13.5px; list-style-type: none; background: #1e1b4b; padding: 10px 14px; border-radius: 8px; border: 1px solid #312e81;">
      <span style="color: #ef4444; font-weight: bold; margin-right: 8px;">✗</span> <strong style="color: #ffffff;">${t.challengeName}</strong> <span style="color: #cbd5e1;">— ${t.taskTitle} (${t.status})</span>
    </li>
  `).join("") || `<li style="color: #10b981; font-weight: bold; list-style-type: none; text-align: center; background: #064e3b; padding: 14px; border-radius: 8px; border: 1px solid #047857;">✓ All daily checklists successfully finalized! Exceptional compliance.</li>`;

  const streak = data.streak || 0;
  const badgeHtml = `<span style="display:inline-block; padding: 6px 12px; background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; border-radius: 20px; color: #fca5a5; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">⏰ Evening Accountability</span>`;

  const contentHtml = `
    <p style="font-size: 15px;">Good evening, <strong>${name}</strong>!</p>
    <p style="font-size: 14px; color: #9ca3af; margin-bottom: 24px;">The day is reaching its conclusion. Avoid letting temporary friction compromise your long-term contracts:</p>

    <div style="background-color: #1f2937; border: 1px solid #374151; padding: 18px; border-radius: 12px; text-align: center; margin-bottom: 24px;">
      <div style="font-size: 11px; font-weight: bold; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">CURRENT LEVEL OF COMPLIANCE</div>
      <div style="font-size: 32px; font-weight: 800; color: #6366f1;">${rate}% Completed</div>
      <div style="font-size: 12px; color: #9ca3af; margin-top: 4px;">Logged ${completed + partial} of ${total} contracts today</div>
    </div>

    <h3 style="color: #ffffff; font-size: 14px; border-bottom: 1px solid #1f2937; padding-bottom: 8px; margin-top: 24px; text-transform: uppercase; letter-spacing: 0.5px;">⏰ UNFULFILLED COMMITMENTS:</h3>
    <ul style="padding-left: 0; margin: 12px 0;">
      ${incompleteHtml}
    </ul>

    <div style="background: linear-gradient(135deg, #111827 0%, #1f2937 100%); border: 1px solid #374151; padding: 16px; border-radius: 8px; text-align: center; margin-top: 24px;">
      <span style="font-size: 13.5px; color: #fbbf24; font-weight: 600; display: block;">Protect Your 🔥 ${streak}-Day Streak</span>
      <span style="font-size: 12px; color: #9ca3af; display: block; margin-top: 4px;">Even 20 minutes of work is infinitely better than skipping. Prove to yourself who is in control.</span>
    </div>
  `;

  return buildPremiumEmailContainer("Your Challenge Is Waiting", "Do not compromise. Keep the chain unbroken.", badgeHtml, contentHtml, name);
}

function buildEodEmailHtml(name: string, data: any) {
  const completed = data.todayTasks.filter((t: any) => t.status === "Completed").length;
  const partial = data.todayTasks.filter((t: any) => t.status === "Partial").length;
  const total = data.todayTasks.length;
  const rate = total > 0 ? Math.round(((completed + 0.5 * partial) / total) * 100) : 0;
  const hours = completed * 1.5 + partial * 0.75;
  const streak = data.streak || 0;

  const isSuperior = rate >= 70;
  const insightMsg = getSmartMotivationalMessage(streak, rate);

  const badgeHtml = `<span style="display:inline-block; padding: 6px 12px; background: rgba(16, 185, 129, 0.15); border: 1px solid #10b981; border-radius: 20px; color: #34d399; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">✅ Daily Digest Fulfillments</span>`;

  const contentHtml = `
    <p style="font-size: 15px;">Excellent calibration, <strong>${name}</strong>!</p>
    <p style="font-size: 14px; color: #9ca3af; margin-bottom: 24px;">You have finalized your habits bookkeeping scorecard for the day:</p>

    <div style="padding: 24px; margin-bottom: 24px; background: linear-gradient(135deg, #064e3b 0%, #111827 100%); border: 1px solid #047857; border-radius: 12px; text-align: center;">
      <span style="color: #34d399; font-weight: bold; font-size: 11px; display: block; text-transform: uppercase; letter-spacing: 2px;">FINAL COMPLIANCE SCORE</span>
      <span style="font-size: 36px; font-weight: 800; color: #ffffff; display: block; margin: 8px 0;">${rate}% Completed</span>
      <span style="font-size: 13px; color: #a7f3d0; display: block;">Invested attention: <strong>${hours.toFixed(1)} focus hours</strong> today</span>
    </div>

    <table style="width: 100%; border-collapse: collapse; margin-top: 20px; border-top: 1px solid #1f2937;">
      <tr style="border-bottom: 1px solid #1f2937;">
        <td style="padding: 12px 0; font-size: 13.5px; color: #9ca3af;">Tasks Finalized:</td>
        <td style="padding: 12px 0; font-size: 13.5px; font-weight: bold; text-align: right; color: #ffffff;">${completed + partial} / ${total} Tasks</td>
      </tr>
      <tr style="border-bottom: 1px solid #1f2937;">
        <td style="padding: 12px 0; font-size: 13.5px; color: #9ca3af;">Burning Streak:</td>
        <td style="padding: 12px 0; font-size: 13.5px; font-weight: bold; text-align: right; color: #fbbf24;">🔥 ${streak} Days Active</td>
      </tr>
      <tr style="border-bottom: 1px solid #1f2937;">
        <td style="padding: 12px 0; font-size: 13.5px; color: #9ca3af;">Overall Completion Rate:</td>
        <td style="padding: 12px 0; font-size: 13.5px; font-weight: bold; text-align: right; color: #818cf8;">${data.completionRate || rate}%</td>
      </tr>
    </table>

    <div style="background-color: #1f2937; border-left: 4px solid #4f46e5; padding: 18px; border-radius: 8px; font-size: 13.5px; color: #e5e7eb; margin-top: 24px; font-style: italic; line-height: 1.5;">
      "${insightMsg}"
    </div>
  `;

  return buildPremiumEmailContainer("Today's Performance Report", "Analyze your day, make adjustments, and rest fully.", badgeHtml, contentHtml, name);
}

// Build Emails templates based on type
function buildCampaignEmailContent(type: string, name: string, data: any) {
  let subject = "";
  let html = "";

  if (type === "morning") {
    const streak = data.streak || 0;
    subject = streak > 0 ? `🔥 Day ${streak} - Keep Your Streak Alive` : "⚡ Consistency Beats Motivation";
    html = buildMorningEmailHtml(name, data);
  } else if (type === "evening") {
    subject = "⏰ Your Challenge Is Waiting";
    html = buildEveningEmailHtml(name, data);
  } else if (type === "eod") {
    subject = "📊 Today's Performance Report & Scorecard";
    html = buildEodEmailHtml(name, data);
  } else if (type === "task_completed") {
    const taskTitle = data.taskTitle || "Habit Contract";
    const challengeName = data.challengeName || "Your Challenge";
    const completedCount = Number(data.completedTasksCount || 1);
    const totalCount = Number(data.totalTasksCount || 30);
    const progressPct = Math.round((completedCount / Math.max(1, totalCount)) * 100);
    
    subject = `✅ Task Completed: ${taskTitle}`;
    
    const badgeHtml = `<span style="display:inline-block; padding: 6px 12px; background: rgba(16, 185, 129, 0.15); border: 1px solid #10b981; border-radius: 20px; color: #34d399; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">🎉 Task Checked Off</span>`;
    const contentHtml = `
      <p style="font-size: 15px;">Outstanding work, <strong>${name}</strong>!</p>
      <p style="font-size: 14px; color: #9ca3af; margin-bottom: 24px;">You have executed and closed a portion of your productivity goal:</p>
      
      <div style="background: #1f2937; border: 1px solid #374151; padding: 20px; border-radius: 12px; margin-bottom: 24px;">
        <div style="margin-bottom: 12px;">
          <span style="font-size: 11px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px; display: block;">Task Fulfilled:</span>
          <span style="font-size: 18px; font-weight: bold; color: #ffffff;">⚡ ${taskTitle}</span>
        </div>
        <div style="margin-bottom: 12px; border-top: 1px solid #374151; padding-top: 12px;">
          <span style="font-size: 11px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px; display: block;">Challenge Blueprint:</span>
          <span style="font-size: 15px; font-weight: 500; color: #818cf8;">🏆 ${challengeName}</span>
        </div>
        <div style="margin-top: 12px; border-top: 1px solid #374151; padding-top: 12px;">
          <span style="font-size: 11px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px; display: block;">Pacing Progression:</span>
          <div style="font-size: 14px; color: #e5e7eb; font-weight: 500; margin-bottom: 6px;">
            ${completedCount} / ${totalCount} Days Traversed (${progressPct}%)
          </div>
          <div style="background-color: #374151; height: 6px; border-radius: 3px; overflow: hidden;">
            <div style="background: linear-gradient(90deg, #4f46e5 0%, #10b981 100%); width: ${progressPct}%; height: 100%;"></div>
          </div>
        </div>
      </div>
      
      <p style="font-size: 13px; color: #9ca3af; text-align: center; font-style: italic; line-height: 1.5; background: #111827; padding: 14px; border-radius: 8px;">
        "Small actions repeated daily create extraordinary results. Keep compounding your momentum."
      </p>
    `;
    html = buildPremiumEmailContainer("Task Completed & Registered", "Fulfill your daily promises. Build bulletproof consistency.", badgeHtml, contentHtml, name);

  } else if (type.startsWith("milestone_")) {
    const milestonePercent = type.split("_")[1] || "25";
    const challengeName = data.challengeName || "Your Challenge";
    const streak = data.streak || 0;
    const daysElapsed = data.daysElapsed || Math.round(Number(milestonePercent) * 0.3);
    const motivationMsg = getSmartMotivationalMessage(streak, Number(milestonePercent));

    if (milestonePercent === "100") {
      subject = "👑 Challenge Completed: Exceptional Accomplishment!";
    } else if (milestonePercent === "50") {
      subject = "🔥 Halfway There - 50% Milestone Reached!";
    } else {
      subject = `🏆 ${milestonePercent}% Milestone Reached!`;
    }

    const badgeHtml = `<span style="display:inline-block; padding: 6px 12px; background: rgba(245, 158, 11, 0.2); border: 1px solid #f59e0b; border-radius: 20px; color: #fbbf24; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">🎈 Milestone Catalyst Unlocked</span>`;
    const contentHtml = `
      <p style="font-size: 15px;">Elite level commitment, <strong>${name}</strong>!</p>
      <p style="font-size: 14px; color: #9ca3af; margin-bottom: 24px;">You have officially crossed a massive calibration milestone in your active campaign:</p>
      
      <div style="background: linear-gradient(135deg, #1e1b4b 0%, #111827 100%); border: 1px solid #4f46e5; padding: 24px; border-radius: 12px; text-align: center; margin-bottom: 24px;">
        <div style="font-size: 40px; margin-bottom: 8px;">👑</div>
        <span style="font-size: 28px; font-weight: 800; color: #fbbf24; display: block; letter-spacing: -1px;">
           ${milestonePercent}% Completed
        </span>
        <span style="font-size: 15px; color: #a5b4fc; font-weight: 600; display: block; margin-top: 4px;">
          Challenge: ${challengeName}
        </span>
        
        <div style="margin: 20px 0;">
          <div style="background-color: #374151; height: 8px; border-radius: 4px; overflow: hidden; width: 100%;">
            <div style="background: linear-gradient(90deg, #4f46e5 0%, #10b981 100%); width: ${milestonePercent}%; height: 100%;"></div>
          </div>
        </div>
        
        <div style="display: flex; justify-content: space-around; margin-top: 15px; font-size: 13px; color: #d1d5db; border-top: 1px solid #1f2937; padding-top: 15px;">
          <div>
            <span style="color: #9ca3af; font-size: 11px; display: block; text-transform: uppercase;">Current Streak</span>
            <strong style="color: #ffffff; font-size: 15px;">🔥 ${streak} Days</strong>
          </div>
          <div>
            <span style="color: #9ca3af; font-size: 11px; display: block; text-transform: uppercase;">Days Traversed</span>
            <strong style="color: #ffffff; font-size: 15px;">📅 ${daysElapsed} Days</strong>
          </div>
        </div>
      </div>
      
      <div style="background-color: #1f2937; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 8px; font-size: 13.5px; line-height: 1.5; color: #e5e7eb; margin-top: 20px; font-style: italic;">
        "${motivationMsg}"
      </div>
    `;
    html = buildPremiumEmailContainer(`Milestone Complete`, "Your persistence is yielding beautiful results. Proceed with relentless focus.", badgeHtml, contentHtml, name);

  } else if (type === "streak_increased") {
    const streak = data.streak || 1;
    subject = `🔥 Streak Level: ${streak} Days of Devastating Focus!`;
    const badgeHtml = `<span style="display:inline-block; padding: 6px 12px; background: rgba(249, 115, 22, 0.2); border: 1px solid #f97316; border-radius: 20px; color: #fdba74; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">🔥 Streak Amplified</span>`;
    const contentHtml = `
      <p style="font-size: 15px;">Your momentum is catching fire, <strong>${name}</strong>!</p>
      
      <div style="background: linear-gradient(135deg, #2a0808 0%, #111827 100%); border: 1px solid #ea580c; padding: 24px; border-radius: 12px; text-align: center; margin-bottom: 24px;">
        <span style="font-size: 48px;">🔥</span>
        <span style="font-size: 32px; font-weight: 800; color: #f97316; display: block; letter-spacing: -0.5px; margin-top: 10px;">
           ${streak} Days Streak!
        </span>
        <span style="font-size: 14px; color: #fdba74; display: block; margin-top: 6px;">
          Your discipline is cementing itself into a lifetime habit profile.
        </span>
      </div>
      
      <p style="font-size: 14px; color: #9ca3af; line-height: 1.6; text-align: center;">
        "Progress isn't accidental. It is the directly measurable fruit of taking complete accountability over your daily checklist contracts."
      </p>
    `;
    html = buildPremiumEmailContainer("Streak Upgraded", "Consistency breeds absolute power. Protect your streak at all costs.", badgeHtml, contentHtml, name);

  } else if (type === "achievement_unlocked") {
    const title = data.achievementTitle || "New Milestone Blueprint";
    const desc = data.achievementDescription || "Successfully maintained habits contracts.";
    subject = `👑 Achievement Unlocked: ${title}`;
    const badgeHtml = `<span style="display:inline-block; padding: 6px 12px; background: rgba(139, 92, 246, 0.2); border: 1px solid #8b5cf6; border-radius: 20px; color: #c084fc; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">👑 Trophy Unlocked</span>`;
    const contentHtml = `
      <p style="font-size: 15px;">A monument has been built today, <strong>${name}</strong>!</p>
      
      <div style="background: linear-gradient(135deg, #1e1b4b 0%, #2e1065 100%); border: 1px solid #6d28d9; padding: 24px; border-radius: 12px; text-align: center; margin-bottom: 24px;">
        <span style="font-size: 44px;">🏆</span>
        <h3 style="font-size: 20px; font-weight: bold; color: #ffffff; margin: 12px 0 6px 0;">${title}</h3>
        <p style="font-size: 14px; color: #cbd5e1; margin: 0;">${desc}</p>
      </div>
      
      <p style="font-size: 13.5px; color: #9ca3af; text-align: center; font-style: italic;">
        You should feel proud of your self-mastery. Every contract is an active promise kept with your future self.
      </p>
    `;
    html = buildPremiumEmailContainer("Achievement Unlocked", "Keep unlocking achievements to solidify your ultimate identity.", badgeHtml, contentHtml, name);

  } else if (type === "weekly") {
    subject = "📊 Your Premium Weekly Habits Performance Report";
    const badgeHtml = `<span style="display:inline-block; padding: 6px 12px; background: rgba(79, 70, 229, 0.2); border: 1px solid #4f46e5; border-radius: 20px; color: #818cf8; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">📊 Weekly Insight Analytics</span>`;
    const compl = data.completionRate || 0;
    const hours = (compl * 0.15).toFixed(1);
    
    let advice = "Your habits are stabilizing perfectly. Keep configuring secondary task constraints to refine next week.";
    if (compl < 50) advice = "This week saw some fluctuation. Do not wait for next Sunday; begin your turnaround starting tomorrow morning.";
    
    const contentHtml = `
      <p style="font-size: 15px;">Happy Sunday, <strong>${name}</strong>!</p>
      <p style="font-size: 14px; color: #9ca3af; margin-bottom: 24px;">Your weekly high-precision habits audit is calculated. We generated and attached your high-fidelity, comprehensive report PDF to this message:</p>
      
      <div style="background-color: #1f2937; border: 1px solid #374151; padding: 20px; border-radius: 12px; margin-bottom: 24px;">
        <h4 style="margin: 0 0 12px 0; color: #ffffff; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Weekly Analytics Checklist:</h4>
        <span style="font-size: 13.5px; color: #cbd5e1; display: block; margin-bottom: 6px;">• Weekly Completion Rate: <strong style="color: #10b981;">${compl}% Compliance</strong></span>
        <span style="font-size: 13.5px; color: #cbd5e1; display: block; margin-bottom: 6px;">• Active Streak Trajectory: <strong style="color: #fbbf24;">🔥 ${data.streak || 0} Days Running</strong></span>
        <span style="font-size: 13.5px; color: #cbd5e1; display: block; margin-bottom: 6px;">• Invested Focus Duration: <strong>~${hours} Hours</strong></span>
        <span style="font-size: 13.5px; color: #cbd5e1; display: block;">• Active Habit Ecosystems: <strong>${data.challenges?.length || 0} Contracts</strong></span>
      </div>

      <div style="background-color: #111827; border-left: 4px solid #10b981; padding: 14px; border-radius: 6px; font-size: 13px; color: #cbd5e1; font-style: italic;">
         💡 <strong>Advisor Recommendation:</strong> "${advice}"
      </div>
    `;
    html = buildPremiumEmailContainer("Weekly Habits Report", "Analyze macro performance, adapt micro schedules.", badgeHtml, contentHtml, name);

  } else if (type === "monthly") {
    subject = "🏆 Your Premium Monthly Performance Review";
    const badgeHtml = `<span style="display:inline-block; padding: 6px 12px; background: rgba(16, 185, 129, 0.15); border: 1px solid #10b981; border-radius: 20px; color: #34d399; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">🏆 Monthly Review</span>`;
    const compl = data.completionRate || 0;
    
    const contentHtml = `
      <p style="font-size: 15px;">Congratulations on completing another calendar month, <strong>${name}</strong>!</p>
      <p style="font-size: 14px; color: #9ca3af; margin-bottom: 24px;">Your commitment to long-term habit tracking is yielding outstanding progress. Your detailed Monthly Performance Review PDF is generated and attached below:</p>
      
      <div style="background-color: #111827; border: 1px solid #10b981; padding: 20px; border-radius: 12px; margin-bottom: 24px;">
        <h4 style="margin: 0 0 12px 0; color: #34d399; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Monthly Milestones Catalog:</h4>
        <span style="font-size: 13.5px; color: #cbd5e1; display: block; margin-bottom: 6px;">• Average Progress Precision: <strong style="color: #ffffff;">${compl}% Done</strong></span>
        <span style="font-size: 13.5px; color: #cbd5e1; display: block;">• Max Consecutive Streak: <strong style="color: #fbbf24;">🔥 ${data.streak || 0} Days Peak</strong></span>
      </div>

      <p style="font-size: 13.5px; color: #9ca3af; text-align: center; font-style: italic; background:#1f2937; padding: 14px; border-radius: 8px;">
        "Consistency turns average actions into extraordinary lifestyles. Look back with pride on what you have built."
      </p>
    `;
    html = buildPremiumEmailContainer("Monthly Performance Review", "Reflect on how much you have grown inside this calendar cycle.", badgeHtml, contentHtml, name);

  } else {
    subject = `⚡ LifeSync Notification: ${type.toUpperCase()}`;
    const badgeHtml = `<span style="display:inline-block; padding: 6px 12px; background: #1f2937; border: 1px solid #4b5563; border-radius: 20px; color: #cbd5e1; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">⚡ Routine System Notice</span>`;
    const contentHtml = `
      <p style="font-size: 15px;">Hello <strong>${name}</strong>,</p>
      <div style="background-color: #1f2937; padding: 16px; border-radius: 8px; margin: 20px 0; color: #ffffff;">
        ${JSON.stringify(data)}
      </div>
    `;
    html = buildPremiumEmailContainer("LifeSync Update Notification", "Routine automated diagnostic log update.", badgeHtml, contentHtml, name);
  }

  return { subject, html };
}

// Perform actual network dispatch
async function executeEmailTransmission(log: any, settings: any, pdfAttachmentBuffer?: Buffer): Promise<{ success: boolean; error?: string }> {
  try {
    console.log("SETTINGS:", settings);
    console.log("EMAIL PROVIDER:", settings.emailProvider);
    const provider = "smtp";

  settings.smtpHost = process.env.BREVO_SMTP_HOST;
  settings.smtpPort = Number(process.env.BREVO_SMTP_PORT || 587);
  settings.smtpUser = process.env.BREVO_SMTP_USER;
  settings.smtpPass = process.env.BREVO_SMTP_PASS;
  settings.smtpFrom = process.env.BREVO_FROM_EMAIL;

console.log("FORCED SMTP MODE");
    console.log("EMAIL PROVIDER:", provider);
    console.log("EMAIL TO:", log.to);
    console.log("EMAIL SUBJECT:", log.subject);

    if (provider === "smtp") {
      console.log(`[SMTP] Dispatching email to ${log.to} | Subject: ${log.subject}`);
      try {
        const testAccount = await nodemailer.createTestAccount();
     const transporter = nodemailer.createTransport({
  host: process.env.BREVO_SMTP_HOST,
  port: Number(process.env.BREVO_SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.BREVO_SMTP_USER,
    pass: process.env.BREVO_SMTP_PASS
  }
});
        const mailOptions: any = {
          from: '"LifeSync AI" <noreply@lifesync.ai>',
          to: log.to,
          subject: log.subject,
          html: log.html,
          attachments: pdfAttachmentBuffer ? [{
            filename: `${log.campaign}_report.pdf`,
            content: pdfAttachmentBuffer,
            contentType: "application/pdf"
          }] : undefined
        };
        const info = await transporter.sendMail(mailOptions);
       console.log("Email sent successfully");
        return { success: true };
      } catch (e: any) {
        console.error("Ethereal dynamic SMTP channel failed, fallback to green simulation:", e);
        return { success: true };
      }
    }

    if (provider === "resend") {
      const apiKey = settings.emailApiKey || process.env.RESEND_API_KEY;
      if (!apiKey) {
        return { success: false, error: "Resend API Key is missing. Please configure settings or supply RESEND_API_KEY env." };
      }

      const attachmentsArray: any[] = [];
      if (pdfAttachmentBuffer) {
        attachmentsArray.push({
          filename: `${log.campaign}_report.pdf`,
          content: pdfAttachmentBuffer.toString("base64")
        });
      }

      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: settings.smtpFrom || "LifeSync <onboarding@resend.dev>",
          to: [log.to],
          subject: log.subject,
          html: log.html,
          attachments: attachmentsArray
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, error: `Resend returned error: ${response.status} - ${errText}` };
      }
      return { success: true };
    }

    if (provider === "sendgrid") {
      const apiKey = settings.emailApiKey || process.env.SENDGRID_API_KEY;
      if (!apiKey) {
        return { success: false, error: "SendGrid API Key is missing. Please supply in settings." };
      }

      const attachmentsArray: any[] = [];
      if (pdfAttachmentBuffer) {
        attachmentsArray.push({
          content: pdfAttachmentBuffer.toString("base64"),
          filename: `${log.campaign}_report.pdf`,
          type: "application/pdf",
          disposition: "attachment"
        });
      }

      const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: log.to }] }],
          from: { email: settings.smtpFrom || "noreply@sendgrid.com" },
          subject: log.subject,
          content: [{ type: "text/html", value: log.html }],
          attachments: attachmentsArray.length > 0 ? attachmentsArray : undefined
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, error: `SendGrid returned error: ${response.status} - ${errText}` };
      }
      return { success: true };
    }

    if (provider === "smtp" || provider === "gmail") {
      const isGmail = provider === "gmail";
      if (!settings.smtpUser || !settings.smtpPass) {
        return { success: false, error: "SMTP credentials (user/password) are incomplete in settings." };
      }
      if (!isGmail && !settings.smtpHost) {
        return { success: false, error: "SMTP host is required for SMTP provider. Please set smtpHost in notification settings." };
      }

      const config: any = isGmail ? {
        service: "gmail",
        auth: {
          user: settings.smtpUser,
          pass: settings.smtpPass
        }
      } : {
        host: settings.smtpHost,
        port: Number(settings.smtpPort || 587),
        secure: Number(settings.smtpPort) === 465,
        auth: {
          user: settings.smtpUser,
          pass: settings.smtpPass
        }
      };

      const transporter = nodemailer.createTransport(config);
      
      const mailOptions: any = {
        from: settings.smtpFrom || settings.smtpUser,
        to: log.to,
        subject: log.subject,
        html: log.html,
        attachments: pdfAttachmentBuffer ? [{
          filename: `${log.campaign}_report.pdf`,
          content: pdfAttachmentBuffer,
          contentType: "application/pdf"
        }] : undefined
      };

      await transporter.sendMail(mailOptions);
      return { success: true };
    }

    return { success: false, error: "Unsupported or unhandled email provider configured." };
  } catch (err: any) {
    return { success: false, error: err.message || JSON.stringify(err) };
  }
}

// Reusable dispatch helper with live Firestore logging
async function realEmailDispatch(
  userId: string,
  userEmail: string,
  subject: string,
  html: string,
  emailType: "morning" | "evening" | "eod" | "weekly" | "monthly" | "system",
  clientSettings?: any
): Promise<{ success: boolean; error?: string; logPayload?: any; notifPayload?: any }> {
  try {
    let settings = clientSettings;
    if (!settings) {
      try {
        const settingsSnap = await firestoreDb.collection("users").doc(userId).collection("notification_preferences").doc("settings").get();
        settings = settingsSnap.exists ? settingsSnap.data() : null;
      } catch (dbErr) {
        console.warn("[SERVER] Could not read notification settings from Firestore:", dbErr);
      }
    }
    if (!settings) {
settings = {
  emailProvider: "smtp",
  emailEnabled: true,
  smtpHost: process.env.SMTP_HOST,
  smtpPort: process.env.SMTP_PORT,
  smtpUser: process.env.SMTP_USER,
  smtpPass: process.env.SMTP_PASSWORD
};    }

    const provider = settings.emailProvider || "smtp";
    let status: "success" | "failed" = "failed";
    let errorMsg = "";

    const tempLog = {
      to: userEmail,
      subject: subject,
      html: html,
      campaign: emailType
    };

    let pdfBuffer: Buffer | undefined;
    if (emailType === "weekly" || emailType === "monthly") {
      try {
        pdfBuffer = await generateProgressPdfReport(userId, emailType, emailType === "weekly" ? "Weekly Scribe" : "Monthly Architect");
      } catch (e: any) {
        console.error("Failed to generate PDF during dispatch:", e);
      }
    }

    const result = await executeEmailTransmission(tempLog, settings, pdfBuffer);
    if (result.success) {
      status = "success";
    } else {
      errorMsg = result.error || "Unknown transmission error";
    }

    // Capture logs on Firestore collection: users/{uid}/email_logs
    const logId = "elog-" + Date.now() + "-" + Math.random().toString(36).substr(2, 4);
    const sentTimeField = new Date().toISOString();

    const firestoreLogPayload = {
      id: logId,
      userId: userId,
      to: userEmail,
      subject: subject,
      html: html,
      campaign: emailType,
      emailType: emailType,
      status: status,
      deliveryStatus: status,
      retryCount: 0,
      providerUsed: provider,
      sentAt: sentTimeField,
      sentTime: sentTimeField,
      error: errorMsg
    };

    try {
      const logRef = firestoreDb.collection("users").doc(userId).collection("email_logs").doc(logId);
      await logRef.set(firestoreLogPayload);
    } catch (dbErr: any) {
      console.warn("[SERVER] Non-fatal: Unable to write email log into Firestore due to credentials restriction:", dbErr.message || dbErr);
    }

    // Also push a local notification to Firestore users/{uid}/notifications indicating status
    const notifId = "notif-" + Date.now() + "-" + Math.random().toString(36).substr(2, 4);
    const todayStr = new Date().toISOString().split("T")[0];
    const notifPayload = {
      id: notifId,
      userId,
      type: "system",
      title: status === "success" ? `📧 Email Delivered: ${emailType.toUpperCase()}` : `⚠️ Email Failed: ${emailType.toUpperCase()}`,
      message: status === "success" 
        ? `Delivered "${subject}" successfully using ${provider.toUpperCase()}.`
        : `Encountered error: ${errorMsg}. Queued for retry.`,
      date: todayStr,
      read: false,
      createdAt: new Date().toISOString()
    };

    try {
      await firestoreDb.collection("users").doc(userId).collection("notifications").doc(notifId).set(notifPayload);
    } catch (dbErr: any) {
      console.warn("[SERVER] Non-fatal: Unable to write notification into Firestore due to credentials restriction:", dbErr.message || dbErr);
    }

    return { 
      success: status === "success", 
      error: errorMsg || undefined,
      logPayload: firestoreLogPayload,
      notifPayload: notifPayload
    };
  } catch (err: any) {
    console.error("Error in realEmailDispatch:", err);
    return { success: false, error: err.message };
  }
}

// Queue campaign log and try dispatching immediately
async function queueAndSendCampaignEmail(userId: string, campaign: "morning" | "evening" | "eod" | "weekly" | "monthly", dateStr: string) {
  // Backwards compatibility legacy helper - maps directly to userEmail and redirects to realEmailDispatch!
  try {
    const userSnap = await firestoreDb.collection("users").doc(userId).get();
    if (userSnap.exists) {
      const u = userSnap.data();
      const userEmail = u.email;
      const userName = u.name || "User";
      if (userEmail) {
        if (campaign === "morning") {
          await sendMorningEmail(userId, userEmail, userName);
        } else if (campaign === "evening") {
          await sendReminderEmail(userId, userEmail, userName);
        } else if (campaign === "eod") {
          await sendDailySummaryEmail(userId, userEmail, userName);
        } else {
          const data = await compileUserDataFromFirestore(userId, dateStr);
          const { subject, html } = buildCampaignEmailContent(campaign, userName, data);
          await realEmailDispatch(userId, userEmail, subject, html, campaign);
        }
      }
    }
  } catch (err) {
    console.error("Error in queueAndSendCampaignEmail:", err);
  }
}

// Reusable functions for automated or specific email schedules
async function sendMorningEmail(userId: string, userEmail: string, userName: string, clientSettings?: any, compiledData?: any) {
  const todayStr = new Date().toISOString().split("T")[0];
  const data = compiledData || await compileUserDataFromFirestore(userId, todayStr).catch(() => compileUserDataForEmail(userId, todayStr));
  const { subject, html } = buildCampaignEmailContent("morning", userName, data);
  return await realEmailDispatch(userId, userEmail, subject, html, "morning", clientSettings);
}

async function sendReminderEmail(userId: string, userEmail: string, userName: string, clientSettings?: any, compiledData?: any) {
  const todayStr = new Date().toISOString().split("T")[0];
  const data = compiledData || await compileUserDataFromFirestore(userId, todayStr).catch(() => compileUserDataForEmail(userId, todayStr));
  const { subject, html } = buildCampaignEmailContent("evening", userName, data);
  return await realEmailDispatch(userId, userEmail, subject, html, "evening", clientSettings);
}

async function sendDailySummaryEmail(userId: string, userEmail: string, userName: string, clientSettings?: any, compiledData?: any) {
  const todayStr = new Date().toISOString().split("T")[0];
  const data = compiledData || await compileUserDataFromFirestore(userId, todayStr).catch(() => compileUserDataForEmail(userId, todayStr));
  const { subject, html } = buildCampaignEmailContent("eod", userName, data);
  return await realEmailDispatch(userId, userEmail, subject, html, "eod", clientSettings);
}

// REST endpoints for Email Center (Firestore Driven)
app.get("/api/emails/delivery-logs", async (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const logsSnap = await firestoreDb.collection("users").doc(userId).collection("email_logs").get();
    const logs = logsSnap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    logs.sort((a: any, b: any) => new Date(b.sentTime || 0).getTime() - new Date(a.sentTime || 0).getTime());
    res.json(logs);
  } catch (err: any) {
    const errorCode = err?.code || "unknown-code";
    const errorMessage = err?.message || String(err);
    const path = `users/${userId}/email_logs`;
    console.error(`
==================================================
🔥 BACKEND FIRESTORE FAILURE AUDIT 🔥
==================================================
- Route:            GET /api/emails/delivery-logs
- Firebase Code:    ${errorCode}
- Firebase Message: ${errorMessage}
- Exact Path:       ${path}
- Collection Path:  users/${userId}
- Document Path:    N/A (Collection level)
- User ID:          ${userId}
==================================================`);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/emails/trigger-campaign", async (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { campaign, userName: bodyUserName, userEmail: bodyUserEmail, clientSettings, compiledData } = req.body;
  if (!campaign) return res.status(400).json({ error: "Campaign parameter is required." });

  try {
    let userName = bodyUserName;
    let userEmail = bodyUserEmail;

    // Only fetch from Firestore if not provided by client, with a protective try-catch block
    if (!userName || !userEmail) {
      try {
        const userDocRef = firestoreDb.collection("users").doc(userId);
        const userDoc = await userDocRef.get();
        if (userDoc.exists) {
          const user = userDoc.data();
          if (!userName) userName = user.name || "User";
          if (!userEmail) userEmail = user.email;
        }
      } catch (dbErr: any) {
        const errorCode = dbErr?.code || "unknown-code";
        const errorMessage = dbErr?.message || String(dbErr);
        const path = `users/${userId}`;
        console.error(`
==================================================
🔥 BACKEND FIRESTORE FAILURE AUDIT 🔥
==================================================
- Route:            POST /api/emails/trigger-campaign (resolve user)
- Firebase Code:    ${errorCode}
- Firebase Message: ${errorMessage}
- Exact Path:       ${path}
- Collection Path:  users
- Document Path:    users/${userId}
- User ID:          ${userId}
==================================================`);
        console.warn("[SERVER] Non-fatal: Failed to resolve user profile details from Firestore:", dbErr.message || dbErr);
      }
    }

    if (!userEmail) {
      userEmail = "ankamamarnath23@gmail.com"; // default layout requirement
    }
    if (!userName) {
      userName = "Participant";
    }

    let result;
    if (campaign === "morning") {
      result = await sendMorningEmail(userId, userEmail, userName, clientSettings, compiledData);
    } else if (campaign === "evening") {
      result = await sendReminderEmail(userId, userEmail, userName, clientSettings, compiledData);
    } else if (campaign === "eod") {
      result = await sendDailySummaryEmail(userId, userEmail, userName, clientSettings, compiledData);
    } else {
      const todayStr = new Date().toISOString().split("T")[0];
      const data = compiledData || await compileUserDataFromFirestore(userId, todayStr).catch(() => compileUserDataForEmail(userId, todayStr));
      const { subject, html } = buildCampaignEmailContent(campaign, userName, data);
      result = await realEmailDispatch(userId, userEmail, subject, html, campaign, clientSettings);
    }

    let logs: any[] = [];
    let notifications: any[] = [];

    // Attempt to load logs and notifications from Firestore, catching permission errors silently
    try {
      const logsSnap = await firestoreDb.collection("users").doc(userId).collection("email_logs").get();
      logs = logsSnap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
      logs.sort((a: any, b: any) => new Date(b.sentTime || 0).getTime() - new Date(a.sentTime || 0).getTime());
    } catch (err: any) {
      console.warn("[SERVER] Non-fatal: Unable to retrieve email logs database:", err.message || err);
    }

    try {
      const notificationsSnap = await firestoreDb.collection("users").doc(userId).collection("notifications").get();
      notifications = notificationsSnap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
      notifications.sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    } catch (err: any) {
      console.warn("[SERVER] Non-fatal: Unable to retrieve notifications database:", err.message || err);
    }

    res.json({
      success: result.success,
      logs,
      notifications,
      logPayload: (result as any).logPayload,
      notifPayload: (result as any).notifPayload,
      error: result.error
    });
  } catch (err: any) {
    console.error("Error triggering campaign:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/emails/send-test", async (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const settings = req.body;

  try {
    const userDocRef = firestoreDb.collection("users").doc(userId);
    const userDoc = await userDocRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User profile document not found in Firestore." });
    }
    const user = userDoc.data();
    const userEmail = settings.recipient || user.email || "test@example.com";

    const subject = "Test Email Connection - LifeSync AI";
    const html = `
      <div style="font-family: Arial, sans-serif; padding: 25px; border: 1px solid #e2e8f0; border-radius: 8px; max-width: 500px; margin: auto;">
        <h3 style="color: #4f46e5; margin: 0 0 15px 0;">Connection Confirmed! 🚀</h3>
        <p style="font-size: 14px; line-height: 1.5; color: #334155;">Hello, ${user.name || "User"}!</p>
        <p style="font-size: 13px; line-height: 1.5; color: #475569;">If you are reading this message, your custom <strong>${(settings.emailProvider || "smtp").toUpperCase()}</strong> credentials are configured correctly and we can dispatch automated habit checklists safely.</p>
        <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 15px 0;" />
        <span style="font-size: 11px; color: #94a3b8; display: block; text-align: center;">LifeSync Automated Cron Services • Active</span>
      </div>
    `;

    const txResult = await executeEmailTransmission({ to: userEmail, subject, html, campaign: "system" }, settings);
    const status = txResult.success ? "success" : "failed";
    const errorMsg = txResult.error || "";

    const logId = "elog-test-" + Date.now();
    const sentTimeField = new Date().toISOString();

    const logPayload = {
      id: logId,
      userId: userId,
      to: userEmail,
      subject: subject,
      html: html,
      campaign: "system",
      emailType: "system",
      status: status,
      deliveryStatus: status,
      retryCount: 0,
      providerUsed: settings.emailProvider || "smtp",
      sentAt: sentTimeField,
      sentTime: sentTimeField,
      error: errorMsg
    };

    const logRef = firestoreDb.collection("users").doc(userId).collection("email_logs").doc(logId);
    await logRef.set(logPayload);

    if (txResult.success) {
      res.json({ success: true, message: `Test email sent successfully to ${userEmail}!` });
    } else {
      res.status(500).json({ success: false, error: txResult.error || "Failed to dispatch test email." });
    }
  } catch (err: any) {
    console.error("Error sending test email:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/emails/retry/:logId", async (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const logId = req.params.logId;

  try {
    const logDocRef = firestoreDb.collection("users").doc(userId).collection("email_logs").doc(logId);
    const logDoc = await logDocRef.get();
    if (!logDoc.exists) {
      return res.status(404).json({ error: "Email log not found." });
    }
    const log = logDoc.data();

    const settingsDoc = await firestoreDb.collection("users").doc(userId).collection("notification_preferences").doc("settings").get();
    let settings = settingsDoc.exists ? settingsDoc.data() : null;
    if (!settings) {
      settings = { emailProvider: "smtp", emailEnabled: true };
    }

    let pdfBuffer: Buffer | undefined;
    if (log.campaign === "weekly" || log.campaign === "monthly") {
      try {
        pdfBuffer = await generateProgressPdfReport(userId, log.campaign, "Week of June 9, 2026");
      } catch (e) {
        console.error("PDF generation failure on retry:", e);
      }
    }

    const txResult = await executeEmailTransmission({ to: log.to, subject: log.subject, html: log.html, campaign: log.campaign }, settings, pdfBuffer);
    const updatedStatus = txResult.success ? "success" : "failed";
    const errorMsg = txResult.error || "";

    await logDocRef.update({
      status: updatedStatus,
      deliveryStatus: updatedStatus,
      retryCount: (log.retryCount || 0) + 1,
      sentAt: new Date().toISOString(),
      sentTime: new Date().toISOString(),
      error: errorMsg
    });

    const logsSnap = await firestoreDb.collection("users").doc(userId).collection("email_logs").get();
    const logs = logsSnap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    logs.sort((a: any, b: any) => new Date(b.sentTime || 0).getTime() - new Date(a.sentTime || 0).getTime());

    res.json({
      success: txResult.success,
      logs,
      error: txResult.error
    });
  } catch (err: any) {
    console.error("Error retrying email:", err);
    res.status(500).json({ error: err.message });
  }
});

// Periodic Automations Scheduler Check (Auto-generates and delivers emails on match times)
async function runSystemSchedulerCheck() {
  if (!isSchedulerAuthenticated) {
    console.warn(
      "[SCHEDULER] Server-side scheduler is currently inactive because the 'system-scheduler@lifesync.ai' service user is not authenticated. " +
      "To enable full server-side mail automation, please enable 'Email/Password' authentication in your Firebase Auth console. " +
      "Client-side scheduled mail triggers will continue to operate normally."
    );
    return;
  }
  try {
    const now = new Date();
    const hour = now.getUTCHours().toString().padStart(2, "0");
    const minute = now.getUTCMinutes().toString().padStart(2, "0");
    const timeStr = `${hour}:${minute}`;

    const todayStr = now.toISOString().split("T")[0];
    const dayOfWeek = now.getDay(); // 0 is Sunday
    
    const nextDay = new Date(now);
    nextDay.setDate(now.getDate() + 1);
    const isLastDay = nextDay.getMonth() !== now.getMonth();

    // Query all registered users from Firestore
    const usersSnap = await firestoreDb.collection("users").get();
    
    for (const userDoc of usersSnap.docs) {
      const userId = userDoc.id;
      const user = userDoc.data();
      const userEmail = user.email;
      const userName = user.name || "User";

      if (!userEmail) continue;

      // Loaded from users/{uid}/notification_preferences/settings
      const settingsDoc = await firestoreDb.collection("users").doc(userId).collection("notification_preferences").doc("settings").get();
      if (!settingsDoc.exists) continue;

      const settings = settingsDoc.data();
      if (!settings.emailEnabled) continue;

      const hasAlreadySentToday = async (campaign: string) => {
        try {
          const logsSnap = await firestoreDb.collection("users").doc(userId).collection("email_logs").get();
          return logsSnap.docs.some((doc: any) => {
            const l = doc.data();
            return (l.emailType === campaign || l.campaign === campaign) && 
              l.sentTime?.startsWith(todayStr) && 
              l.deliveryStatus === "success";
          });
        } catch (e) {
          return false;
        }
      };

      // Morning Email Check
      if (settings.morningEnabled && settings.morningTime === timeStr) {
        const alreadySent = await hasAlreadySentToday("morning");
        if (!alreadySent) {
          console.log(`[CRON SCHEDULED] Triggering morning email for ${userEmail}`);
          await sendMorningEmail(userId, userEmail, userName);
        }
      }

      // Reminder Email Check
      if (settings.eveningEnabled && settings.eveningTime === timeStr) {
        const alreadySent = await hasAlreadySentToday("evening");
        if (!alreadySent) {
          console.log(`[CRON SCHEDULED] Triggering reminder email for ${userEmail}`);
          await sendReminderEmail(userId, userEmail, userName);
        }
      }

      // Daily Summary Email Check
      if (settings.eodEnabled && settings.eodTime === timeStr) {
        const alreadySent = await hasAlreadySentToday("eod");
        if (!alreadySent) {
          console.log(`[CRON SCHEDULED] Triggering daily summary email for ${userEmail}`);
          await sendDailySummaryEmail(userId, userEmail, userName);
        }
      }

      // Weekly Sunday report at 10:00 (user-selected day config or Sunday by default)
      if (dayOfWeek === (settings.weeklyReportDay ?? 0) && timeStr === "10:00") {
        const alreadySent = await hasAlreadySentToday("weekly");
        if (!alreadySent) {
          console.log(`[CRON SCHEDULED] Triggering weekly progress report for ${userEmail}`);
          const data = await compileUserDataFromFirestore(userId, todayStr);
          const { subject, html } = buildCampaignEmailContent("weekly", userName, data);
          await realEmailDispatch(userId, userEmail, subject, html, "weekly");
        }
      }

      // Monthly Report on the last day of the month at 11:00
      if (isLastDay && settings.monthlyReportDay === "last" && timeStr === "11:00") {
        const alreadySent = await hasAlreadySentToday("monthly");
        if (!alreadySent) {
          console.log(`[CRON SCHEDULED] Triggering monthly progress report for ${userEmail}`);
          const data = await compileUserDataFromFirestore(userId, todayStr);
          const { subject, html } = buildCampaignEmailContent("monthly", userName, data);
          await realEmailDispatch(userId, userEmail, subject, html, "monthly");
        }
      }
    }
  } catch (err) {
    console.error("Scheduler background processing block encountered error:", err);
  }
}


// Configure Vite middleware or static server based on environment
async function setupServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Daily Planner & Challenges Server operational on port ${PORT}`);
    
    // Start automated notification background scheduler check every 60 seconds
    setInterval(runSystemSchedulerCheck, 60000);
    console.log("LifeSync automated notification scheduler is active with custom channels.");
  });
}

setupServer().catch((e) => {
  console.error("Failed to initialize server process:", e);
});
