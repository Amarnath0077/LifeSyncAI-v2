import React, { useState } from "react";
import { Sparkles, Eye, EyeOff, Check, AlertCircle } from "lucide-react";
import { User } from "../types";
import { auth } from "../firebase";
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  updateProfile, 
  signInWithPopup, 
  GoogleAuthProvider 
} from "firebase/auth";

interface AuthViewProps {
  onLoginSuccess: (user: User) => void;
}

export default function AuthView({ onLoginSuccess }: AuthViewProps) {
  const [isLogin, setIsLogin] = useState<boolean>(true);
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      if (isLogin) {
        // Firebase Sign In
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const fbUser = userCredential.user;
        
        setSuccess("Login successful! Welcome back.");
        setTimeout(() => {
          onLoginSuccess({
            id: fbUser.uid,
            name: fbUser.displayName || fbUser.email?.split("@")[0] || "User",
            email: fbUser.email || ""
          });
        }, 800);
      } else {
        // Firebase Sign Up
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const fbUser = userCredential.user;
        
        // Update profile displayName
        await updateProfile(fbUser, { displayName: name || "User" });
        
        setSuccess("Account registered successfully! Logging you in...");
        setTimeout(() => {
          onLoginSuccess({
            id: fbUser.uid,
            name: name || "User",
            email: fbUser.email || ""
          });
        }, 1200);
      }
    } catch (err: any) {
      let friendlyMessage = err.message;
      if (err.code === "auth/email-already-in-use") {
        friendlyMessage = "This email is already in use by another account.";
      } else if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password") {
        friendlyMessage = "Invalid email or password. Please try again.";
      } else if (err.code === "auth/user-not-found") {
        friendlyMessage = "No user account found with this email.";
      } else if (err.code === "auth/weak-password") {
        friendlyMessage = "The password provided is too weak. Choose at least 6 characters.";
      }
      setError(friendlyMessage || "Authentication request failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const fbUser = result.user;

      setSuccess(`Signed in successfully with Google as ${fbUser.displayName || fbUser.email}!`);
      setTimeout(() => {
        onLoginSuccess({
          id: fbUser.uid,
          name: fbUser.displayName || fbUser.email?.split("@")[0] || "User",
          email: fbUser.email || ""
        });
      }, 1000);
    } catch (err: any) {
      console.error("Google Sign-In Error", err);
      setError(err.message || "Google Sign-In failed or was cancelled.");
    } finally {
      setLoading(false);
    }
  };

  const handleDemoAccess = () => {
    setEmail("ankamamarnath23@gmail.com");
    setPassword("password123");
    setIsLogin(true);
    setError(null);
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center p-4 bg-slate-950 text-slate-100" id="auth-panel-container">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-8 shadow-2xl transition duration-300">
        <div className="flex flex-col items-center mb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 shadow-md mb-2">
            <Sparkles className="h-6 w-6 text-white" />
          </div>
          <h2 className="text-2xl font-black text-white text-center" id="auth-main-title">
            LifeSync AI
          </h2>
          <p className="text-xs text-slate-400 mt-1 uppercase tracking-widest text-center">Recurring Challenges & AI Coach</p>
        </div>

        {/* Tab Selection */}
        <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1.5 rounded-xl mb-6">
          <button
            onClick={() => {
              setIsLogin(true);
              setError(null);
              setSuccess(null);
            }}
            className={`py-2 rounded-lg text-xs font-bold transition ${
              isLogin
                ? "bg-slate-800 text-white shadow-md"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            Log In
          </button>
          <button
            onClick={() => {
              setIsLogin(false);
              setError(null);
              setSuccess(null);
            }}
            className={`py-2 rounded-lg text-xs font-bold transition ${
              !isLogin
                ? "bg-slate-800 text-white shadow-md"
                : "text-slate-500 hover:text-slate-350"
            }`}
          >
            Create Account
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-rose-500/10 text-rose-500 border border-rose-500/20 text-xs font-semibold rounded-xl mb-4">
            <AlertCircle className="h-4.5 w-4.5 text-rose-500 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="flex items-center gap-2 p-3 bg-emerald-500/10 text-emerald-450 border border-emerald-500/20 text-xs font-semibold rounded-xl mb-4">
            <Check className="h-4.5 w-4.5 text-emerald-450 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Full Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="John Doe"
                className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Password</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3.5 py-2.5 pr-10 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-white"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 text-xs font-bold text-white transition text-center shadow-lg shadow-indigo-600/15 cursor-pointer mt-2"
          >
            {loading ? "Processing..." : isLogin ? "Access Dashboard" : "Register Account"}
          </button>
        </form>

        {/* Separator */}
        <div className="relative flex py-5 items-center">
          <div className="flex-grow border-t border-slate-800"></div>
          <span className="flex-shrink mx-4 text-slate-500 text-[10px] font-bold uppercase tracking-wider">or</span>
          <div className="flex-grow border-t border-slate-800"></div>
        </div>

        {/* Google Sign-In Button */}
        <button
          onClick={handleGoogleSignIn}
          type="button"
          disabled={loading}
          className="w-full py-2.5 rounded-xl border border-slate-800 bg-slate-950 hover:bg-slate-900 disabled:bg-slate-950/50 text-xs font-bold text-white transition flex items-center justify-center gap-2 cursor-pointer shadow-sm"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24">
            <path
              fill="#EA4335"
              d="M12 5.04c1.66 0 3.2.57 4.38 1.69l3.27-3.27C17.67 1.48 14.97 1 12 1 7.35 1 3.4 3.65 1.5 7.5l3.85 2.99C6.27 7.23 8.91 5.04 12 5.04z"
            />
            <path
              fill="#4285F4"
              d="M23.49 12.27c0-.81-.07-1.59-.2-2.36H12v4.51h6.46c-.28 1.48-1.12 2.73-2.38 3.58l3.7 2.87c2.16-2 3.71-4.94 3.71-8.6z"
            />
            <path
              fill="#FBBC05"
              d="M5.35 14.01c-.24-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29L1.5 6.44C.54 8.35 0 10.49 0 12.75s.54 4.4 1.5 6.31l3.85-3.05z"
            />
            <path
              fill="#34A853"
              d="M12 23c3.24 0 5.97-1.07 7.96-2.91l-3.7-2.87c-1.02.68-2.33 1.09-4.26 1.09-3.09 0-5.73-2.19-6.65-5.45L1.5 15.91C3.4 19.75 7.35 23 12 23z"
            />
          </svg>
          <span>Continue with Google</span>
        </button>

        {isLogin && (
          <div className="mt-6 text-center">
            <button
              onClick={handleDemoAccess}
              className="text-xs font-semibold text-indigo-500 hover:text-indigo-600 transition"
            >
              Fill with Demo Credentials
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
