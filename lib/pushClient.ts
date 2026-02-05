export const DEVICE_ID_KEY = "waianda_device_id";

export function getOrCreateDeviceId() {
  if (typeof window === "undefined") return "";
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

export function getStoredDeviceId() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(DEVICE_ID_KEY) || "";
}
