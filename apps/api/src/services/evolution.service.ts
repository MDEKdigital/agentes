const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL!;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY!;

interface SendTextPayload {
  number: string;
  text: string;
}

async function evolutionFetch(path: string, options: RequestInit = {}) {
  const response = await fetch(`${EVOLUTION_API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body != null ? { "Content-Type": "application/json" } : {}),
      apikey: EVOLUTION_API_KEY,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Evolution API error ${response.status}: ${body.slice(0, 200)}`);
  }

  return response.json();
}

export async function createInstance(instanceName: string, webhookUrl: string) {
  return evolutionFetch("/instance/create", {
    method: "POST",
    body: JSON.stringify({
      instanceName,
      integration: "WHATSAPP-BAILEYS",
      webhook: {
        url: webhookUrl,
        webhookByEvents: false,
        webhookBase64: false,
        events: ["MESSAGES_UPSERT"],
        headers: {
          apikey: process.env.WEBHOOK_SECRET!,
        },
      },
    }),
  });
}

export async function getInstanceStatus(instanceName: string) {
  return evolutionFetch(`/instance/connectionState/${encodeURIComponent(instanceName)}`);
}

export async function getInstanceQrCode(instanceName: string) {
  return evolutionFetch(`/instance/connect/${encodeURIComponent(instanceName)}`);
}

export async function sendText(instanceName: string, payload: SendTextPayload) {
  return evolutionFetch(`/message/sendText/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    body: JSON.stringify({
      number: payload.number,
      text: payload.text,
    }),
  });
}

export async function deleteInstance(instanceName: string) {
  return evolutionFetch(`/instance/delete/${encodeURIComponent(instanceName)}`, {
    method: "DELETE",
  });
}

export async function logoutInstance(instanceName: string) {
  return evolutionFetch(`/instance/logout/${encodeURIComponent(instanceName)}`, {
    method: "DELETE",
  });
}

export async function fetchProfile(instanceName: string, number: string) {
  const cleaned = number.replace(/\D/g, "");
  return evolutionFetch(`/chat/fetchProfile/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    body: JSON.stringify({ number: cleaned }),
  });
}

export async function fetchInstanceDetails(instanceName: string) {
  const data = await evolutionFetch(
    `/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`
  );
  const list = Array.isArray(data) ? data : [data];
  return (list.find((i: Record<string, unknown>) => i.name === instanceName) || list[0] || null) as Record<string, unknown> | null;
}

export async function updateProfileName(instanceName: string, name: string) {
  return evolutionFetch(`/chat/updateProfileName/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function updateProfileStatus(instanceName: string, status: string) {
  return evolutionFetch(`/chat/updateProfileStatus/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

export async function updateProfilePicture(instanceName: string, pictureBase64: string) {
  return evolutionFetch(`/chat/updateProfilePicture/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    body: JSON.stringify({ picture: pictureBase64 }),
  });
}

export async function getInstanceSettings(instanceName: string) {
  return evolutionFetch(`/settings/find/${encodeURIComponent(instanceName)}`);
}

export async function setInstanceSettings(instanceName: string, settings: Record<string, unknown>) {
  return evolutionFetch(`/settings/set/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    body: JSON.stringify(settings),
  });
}

export async function getPrivacySettings(instanceName: string) {
  return evolutionFetch(`/chat/fetchPrivacySettings/${encodeURIComponent(instanceName)}`);
}

export async function updatePrivacySettings(instanceName: string, settings: Record<string, unknown>) {
  return evolutionFetch(`/chat/updatePrivacySettings/${encodeURIComponent(instanceName)}`, {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

export async function restartInstance(instanceName: string) {
  return evolutionFetch(`/instance/restart/${encodeURIComponent(instanceName)}`, {
    method: "PUT",
  });
}

export async function requestPairingCode(instanceName: string, phoneNumber: string) {
  return evolutionFetch(`/instance/pairingCode/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    body: JSON.stringify({ number: phoneNumber }),
  });
}
