import {
	type Configuration,
	PublicClientApplication,
} from "@azure/msal-browser";

const clientId = import.meta.env.VITE_ENTRA_SPA_CLIENT_ID;
const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID;
const apiClientId = import.meta.env.VITE_ENTRA_API_CLIENT_ID;

if (!clientId || !tenantId || !apiClientId) {
	throw new Error("Missing required VITE_ENTRA_* environment variables");
}

const msalConfig: Configuration = {
	auth: {
		clientId,
		authority: `https://login.microsoftonline.com/${tenantId}`,
		redirectUri: window.location.origin,
	},
	cache: {
		cacheLocation: "sessionStorage",
	},
};

export const msal = new PublicClientApplication(msalConfig);

// ✅ React の mount/unmount と無関係に「プロセス内で1回だけ」保証する
let initPromise: Promise<void> | null = null;

export async function initAuth(): Promise<void> {
	if (!initPromise) {
		initPromise = (async () => {
			await msal.initialize();
			await msal.handleRedirectPromise();
		})();
	}
	await initPromise;
}

export async function signIn(): Promise<void> {
	await initAuth();
	await msal.loginRedirect({
		scopes: ["openid", "profile", "email"],
	});
}

export async function getApiAccessToken(): Promise<string> {
	await initAuth();

	const account = msal.getAllAccounts()[0];
	if (!account) {
		throw new Error("User is not signed in");
	}

	const scopes = [`api://${apiClientId}/access_as_user`];

	try {
		const result = await msal.acquireTokenSilent({ account, scopes });
		return result.accessToken;
	} catch {
		await msal.acquireTokenRedirect({ scopes });
		return "";
	}
}

export async function signOut(): Promise<void> {
	await initAuth();

	const account = msal.getAllAccounts()[0];
	if (!account) {
		return;
	}

	await msal.logoutRedirect({ account });
}
