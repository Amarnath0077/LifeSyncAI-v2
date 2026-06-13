import { doc, getDocFromServer } from "firebase/firestore";
import { db, auth } from "./lib/firebase";

export { db, auth };

// Test Connection asynchronously (Mandatory Guideline Constraint)
async function testConnection() {
  try {
    await getDocFromServer(doc(db, "test", "connection"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("the client is offline")) {
      console.error("Please check your Firebase configuration of the workspace.");
    }
  }
}
testConnection();

// Mandatory strict Firestore diagnostic error feedback handler
export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const fbError = error as any;
  const errorCode = fbError?.code || "unknown-code";
  const errorMessage = fbError?.message || (error instanceof Error ? error.message : String(error));
  
  let collectionPath = "unknown";
  let documentPath = "unknown";
  if (path) {
    const segments = path.split("/").filter(Boolean);
    if (segments.length % 2 === 0) {
      documentPath = segments.join("/");
      collectionPath = segments.slice(0, -1).join("/");
    } else {
      collectionPath = segments.join("/");
      documentPath = "N/A (Collection level)";
    }
  }

  const detailedLog = `
==================================================
🔥 FIRESTORE OPERATION FAILURE AUDIT 🔥
==================================================
- Operation Type:   ${operationType.toUpperCase()}
- Firebase Code:    ${errorCode}
- Firebase Message: ${errorMessage}
- Exact Path:       ${path || "unknown"}
- Collection Path:  ${collectionPath}
- Document Path:    ${documentPath}
- Auth UID (currentUser): ${auth.currentUser?.uid || "NOT LOGGED IN / NULL"}
==================================================`;

  console.error(detailedLog);

  const errInfo: FirestoreErrorInfo = {
    error: errorMessage,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  throw new Error(JSON.stringify(errInfo));
}
