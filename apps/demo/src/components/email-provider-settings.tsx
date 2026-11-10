type Props = {
  configured: boolean;
  senderEmail: string | null;
  verified: boolean;
  saved: boolean;
  removed: boolean;
  error?: string;
  save: (data: FormData) => Promise<void>;
  disconnect: () => Promise<void>;
};

export function EmailProviderSettings({ configured, senderEmail, verified, saved, removed, error, save, disconnect }: Props) {
  const errorMessage = error === "config" ? "Email connection setup is not available. Contact your Waybook administrator." : error === "invalid" ? "Enter a valid sender email and API key." : error ? "Could not save the connection. Please try again." : null;
  return <div className="email-provider-settings">
    <div className="email-workspace__heading"><div><h1>Email provider</h1><p>Use your business’s Resend account for booking emails.</p></div></div>
    {saved ? <p role="status">Connection saved. Verification is not available yet, so sending remains off.</p> : null}
    {removed ? <p role="status">Connection removed. Revoke the API key in Resend if it is no longer needed.</p> : null}
    {errorMessage ? <p role="alert">{errorMessage}</p> : null}
    {senderEmail ? <section className="email-provider-current"><h2>Saved connection</h2><p>{senderEmail}</p><p>{verified ? "Verified" : "Not verified · Sending is off"}</p><form action={disconnect}><button type="submit">Disconnect</button></form></section> : null}
    {!configured ? <p>Email provider setup is not available yet. Contact your Waybook administrator.</p> : <form className="email-template-editor" action={save}>
      <h2>{senderEmail ? "Replace connection" : "Connect Resend"}</h2>
      <p>Verify your sending domain in Resend, then create a sending-only API key for that domain. Saving replaces any existing connection; the new connection remains unverified.</p>
      <label>Sender email<input name="senderEmail" type="email" maxLength={254} defaultValue={senderEmail ?? ""} autoComplete="email" required /></label>
      <label>Resend API key<input name="apiKey" type="password" autoComplete="off" maxLength={4096} required /></label>
      <p>The API key is encrypted and will not be shown again. Waybook does not verify or send email yet.</p>
      <button type="submit">Save connection</button>
    </form>}
  </div>;
}
