type Props = {
  configured: boolean;
  deliveryEnabled: boolean;
  senderEmail: string | null;
  verified: boolean;
  testAccepted: boolean;
  saved: boolean;
  removed: boolean;
  testSent: boolean;
  providerVerified: boolean;
  error?: string;
  save: (data: FormData) => Promise<void>;
  disconnect: () => Promise<void>;
  sendTest: () => Promise<void>;
  confirmTest: () => Promise<void>;
};

export function EmailProviderSettings({ configured, deliveryEnabled, senderEmail, verified, testAccepted, saved, removed, testSent, providerVerified, error, save, disconnect, sendTest, confirmTest }: Props) {
  const errorMessage = error === "config" ? "Email connection setup is not available. Contact your Waybook administrator." : error === "invalid" ? "Enter a valid sender email and API key." : error === "busy" ? "A test is already in progress. Please wait." : error === "retry" ? "The test could not be confirmed. Try again shortly." : error === "rejected" ? "Resend rejected the test. Check your sending-only API key and verified sender domain." : error === "review" ? "The test result is uncertain. Check your inbox before retrying." : error ? "Could not complete the request. Please try again." : null;
  return <div className="email-provider-settings">
    <div className="email-workspace__heading"><div><h1>Email provider</h1><p>Use your business’s Resend account for booking emails.</p></div></div>
    {saved ? <p role="status">Connection saved. Send a test and confirm receipt to verify it.</p> : null}
    {removed ? <p role="status">Connection removed. Revoke the API key in Resend if it is no longer needed.</p> : null}
    {testSent ? <p role="status">Resend accepted the test. Check the sender inbox, then confirm receipt below.</p> : null}
    {providerVerified ? <p role="status">Sender verified. {deliveryEnabled ? "Booking emails can now be queued for delivery." : "Automatic delivery is currently disabled."}</p> : null}
    {errorMessage ? <p role="alert">{errorMessage}</p> : null}
    {senderEmail ? <section className="email-provider-current"><h2>Saved connection</h2><p>{senderEmail}</p><p>{verified ? (deliveryEnabled ? "Sender verified · Delivery enabled" : "Sender verified · Delivery disabled") : "Not verified · Sending is off"}</p>
      {!verified && !testAccepted ? <form action={sendTest}><button type="submit">Send test email to {senderEmail}</button></form> : null}
      {!verified && testAccepted ? <form action={confirmTest}><p>Check your inbox for the test before confirming.</p><button type="submit">I received the test email</button></form> : null}
      <form action={disconnect}><button type="submit">Disconnect</button></form></section> : null}
    {!configured ? <p>Email provider setup is not available yet. Contact your Waybook administrator.</p> : <form className="email-template-editor" action={save}>
      <h2>{senderEmail ? "Replace connection" : "Connect Resend"}</h2>
      <p>Verify your sending domain in Resend, then create a sending-only API key for that domain. Saving replaces any existing connection; the new connection remains unverified.</p>
      <label>Sender email<input name="senderEmail" type="email" maxLength={254} defaultValue={senderEmail ?? ""} autoComplete="email" required /></label>
      <label>Resend API key<input name="apiKey" type="password" autoComplete="off" maxLength={4096} required /></label>
      <p>The API key is encrypted and will not be shown again. Verify the sender before booking emails can be delivered.</p>
      <button type="submit">Save connection</button>
    </form>}
  </div>;
}
