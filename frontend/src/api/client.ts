import { getApiAccessToken } from "../auth/msal";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;

if (!apiBaseUrl) {
	throw new Error("VITE_API_BASE_URL is not defined");
}

export async function callApi(path: string): Promise<unknown> {
	const token = await getApiAccessToken();

	const response = await fetch(`${apiBaseUrl}${path}`, {
		headers: {
			Authorization: `Bearer ${token}`,
		},
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`API ${response.status}: ${text}`);
	}

	return response.json();
}
