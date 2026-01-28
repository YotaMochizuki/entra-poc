import { useEffect, useState } from "react";
import { callApi } from "./api/client";
import {
	getApiAccessToken,
	initAuth,
	msal,
	signIn,
	signOut,
} from "./auth/msal";

type ApiResult = {
	ok: boolean;
	claims?: unknown;
};

export default function App(): JSX.Element {
	const [status, setStatus] = useState<string>("initializing");
	const [result, setResult] = useState<ApiResult | null>(null);
	const [tokenInfo, setTokenInfo] = useState<unknown>(null);

	useEffect(() => {
		const bootstrap = async (): Promise<void> => {
			try {
				await initAuth();
				const account = msal.getAllAccounts()[0];
				setStatus(account ? `Signed in: ${account.username}` : "Signed out");
			} catch (error) {
				console.error("bootstrap error:", error);
				setStatus(error instanceof Error ? error.message : "Unknown error");
			}
		};

		void bootstrap();
	}, []);

	const showTokenInfo = async (): Promise<void> => {
		try {
			setStatus("Reading token...");
			const token = await getApiAccessToken();

			// JWT payload をデコード（表示用。署名検証はしない）
			const parts = token.split(".");
			if (parts.length < 2) {
				throw new Error("Invalid JWT format");
			}

			const base64Url = parts[1] ?? "";
			const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
			const json = decodeURIComponent(
				atob(base64)
					.split("")
					.map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
					.join(""),
			);

			const payload = JSON.parse(json) as unknown;

			setTokenInfo(payload);
			setStatus("Token decoded");
		} catch (error) {
			console.error("token decode error:", error);
			setStatus(error instanceof Error ? error.message : "Token decode error");
		}
	};

	const handleCallApi = async (): Promise<void> => {
		try {
			setStatus("Calling API...");
			const data = (await callApi("/me")) as ApiResult;
			setResult(data);
			setStatus("OK");
		} catch (error) {
			console.error("api error:", error);
			setStatus(error instanceof Error ? error.message : "API error");
		}
	};

	const signedIn = msal.getAllAccounts().length > 0;

	return (
		<div style={{ padding: 16, fontFamily: "sans-serif" }}>
			<h2>Entra SPA → Actix API</h2>
			<p>Status: {status}</p>

			{!signedIn ? (
				<button type="button" onClick={() => void signIn()}>
					Sign in
				</button>
			) : (
				<>
					<button type="button" onClick={() => void signOut()}>
						Sign out
					</button>{" "}
					<button type="button" onClick={() => void showTokenInfo()}>
						Show token info
					</button>{" "}
					<button type="button" onClick={() => void handleCallApi()}>
						Call /me
					</button>
				</>
			)}

			{tokenInfo !== null && (
				<pre style={{ marginTop: 16, padding: 12, border: "1px solid #ccc" }}>
					{JSON.stringify(tokenInfo, null, 2)}
				</pre>
			)}

			{result !== null && (
				<pre style={{ marginTop: 16, padding: 12, border: "1px solid #ccc" }}>
					{JSON.stringify(result, null, 2)}
				</pre>
			)}
		</div>
	);
}
