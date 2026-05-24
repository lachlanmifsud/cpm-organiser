import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { firebaseConfig } from "@/lib/firebase/config";

const hasFirebaseConfig = Boolean(
	firebaseConfig.apiKey &&
		firebaseConfig.authDomain &&
		firebaseConfig.projectId &&
		firebaseConfig.storageBucket &&
		firebaseConfig.messagingSenderId &&
		firebaseConfig.appId,
);

const app = hasFirebaseConfig
	? getApps().length > 0
		? getApp()
		: initializeApp(firebaseConfig)
	: null;

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const storage = app ? getStorage(app) : null;
