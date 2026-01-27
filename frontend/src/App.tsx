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

	useEffect(() => {
		const bootstrap = async (): Promise<void> => {
			try {
				await initAuth();
				const account = msal.getAllAccounts()[0];
				setStatus(account ? `Signed in: ${account.username}` : "Signed out");
			} catch (error) {
				setStatus(error instanceof Error ? error.message : "Unknown error");
			}
		};

		void bootstrap();
	}, []);

	const handleCallApi = async (): Promise<void> => {
		try {
			setStatus("Calling API...");
			const data = (await callApi("/me")) as ApiResult;
			setResult(data);
			setStatus("OK");
		} catch (error) {
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
					<button
						type="button"
						onClick={() => {
							void (async () => {
								try {
									const token = await getApiAccessToken();
									console.log("access token head:", token.slice(0, 20));
									setStatus("Token OK (see console)");
								} catch (e) {
									console.error(e);
									setStatus(e instanceof Error ? e.message : "Token error");
								}
							})();
						}}
					>
						Show token head
					</button>{" "}
					<button type="button" onClick={() => void handleCallApi()}>
						Call /me
					</button>
				</>
			)}

			{result !== null && (
				<pre style={{ marginTop: 16, padding: 12, border: "1px solid #ccc" }}>
					{JSON.stringify(result, null, 2)}
				</pre>
			)}
		</div>
	);
}
