declare module "web-push" {
  type PushSubscription = {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
  };

  type WebPushError = Error & { statusCode?: number };

  function setVapidDetails(
    subject: string,
    publicKey: string,
    privateKey: string
  ): void;

  function sendNotification(
    subscription: PushSubscription,
    payload?: string
  ): Promise<void>;

  const webpush: {
    setVapidDetails: typeof setVapidDetails;
    sendNotification: typeof sendNotification;
  };

  export { setVapidDetails, sendNotification, WebPushError };
  export default webpush;
}
