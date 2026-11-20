type Props = {
  configured: boolean;
  onboardingTestAvailable: boolean;
  deliveryEnabled: boolean;
  senderEmail: string | null;
  verified: boolean;
  testAccepted: boolean;
  saved: boolean;
  removed: boolean;
  testSent: boolean;
  onboardingTestSent: boolean;
  providerVerified: boolean;
  error?: string;
  save: (data: FormData) => Promise<void>;
  disconnect: () => Promise<void>;
  sendTest: () => Promise<void>;
  sendOnboardingTest: () => Promise<void>;
  confirmTest: () => Promise<void>;
};

export function EmailProviderSettings({ configured, onboardingTestAvailable, deliveryEnabled, senderEmail, verified, testAccepted, saved, removed, testSent, onboardingTestSent, providerVerified, error, save, disconnect, sendTest, sendOnboardingTest, confirmTest }: Props) {
  const errorMessage = error === "config" ? "Email connection setup is not available. Contact your Waybook administrator." : error === "invalid" ? "Enter a valid sender email and API key." : error === "busy" ? "A test is already in progress. Please wait." : error === "retry" ? "The test could not be confirmed. Try again shortly." : error === "rejected" ? "Resend rejected the test. Check your sending-only API key and verified sender domain." : error === "review" ? "The test result is uncertain. Check your inbox before retrying." : error ? "Could not complete the request. Please try again." : null;
  return <div className="email-provider-settings">
    <div className="email-workspace__heading"><div><h1>Email provider</h1><p>Use your business’s Resend account for booking emails.</p></div></div>
    {saved ? <p role="status">Connection saved. Send a test and confirm receipt to verify it.</p> : null}
    {removed ? <p role="status">Connection removed. Revoke the API key in Resend if it is no longer needed.</p> : null}
    {testSent ? <p role="status">Resend accepted the test. Check the sender inbox, then confirm receipt below.</p> : null}
    {onboardingTestSent ? <p role="status">Resend accepted the confirmation format and connectivity test to the configured QA mailbox. This does not confirm normal outbox delivery.</p> : null}
    {providerVerified ? <p role="status">{deliveryEnabled ? "Sender verified." : "Sender verified. Automatic booking emails are not enabled yet."}</p> : null}
    {errorMessage ? <p role="alert">{errorMessage}</p> : null}
    {onboardingTestAvailable ? <section className="email-provider-current email-provider-current--test"><div className="email-provider-current__top"><h2>QA email test</h2><span className="email-provider-current__badge">Test only</span></div><p>Send a sample confirmation with fictional booking details to the configured QA inbox. This does not send emails to clients.</p><div className="email-provider-current__actions"><form action={sendOnboardingTest}><button type="submit">Send sample confirmation</button></form></div></section> : null}
    {senderEmail ? <section className="email-provider-current"><div className="email-provider-current__top"><h2>Business sender</h2><span className={`email-provider-current__badge${verified ? " email-provider-current__badge--verified" : ""}`}>{verified ? "Verified" : "Not verified"}</span></div><p className="email-provider-current__address">{senderEmail}</p><p>{verified ? (deliveryEnabled ? "This sender has been verified." : "This sender has been verified. Automatic booking emails are currently off.") : "This sender has not been verified. Replace it below with an email address on your verified Resend domain, then send and confirm a test."}</p>
      <div className="email-provider-current__actions">{!verified && !testAccepted ? <form action={sendTest}><button type="submit">Send verification email</button></form> : null}
      {!verified && testAccepted ? <form action={confirmTest}><p>Check the sender inbox before confirming.</p><button type="submit">I received the test email</button></form> : null}
      <form action={disconnect}><button className="email-provider-current__secondary" type="submit">Disconnect</button></form></div></section> : null}
    <section className="email-provider-brand" aria-label="About Resend">
      <div><img className="email-provider-brand__logo email-provider-brand__logo--light" src="/resend-wordmark-black.svg" alt="Resend" /><img className="email-provider-brand__logo email-provider-brand__logo--dark" src="/resend-wordmark-white.svg" alt="Resend" /></div>
      <div><p>Connect your own Resend account to manage your business’s booking emails.</p><div className="email-provider-brand__links"><a href="https://resend.com/signup" target="_blank" rel="noopener noreferrer">Create a Resend account <span aria-hidden="true">↗</span></a><a href="https://resend.com/login" target="_blank" rel="noopener noreferrer">Sign in to Resend <span aria-hidden="true">↗</span></a></div></div>
    </section>
    <form className="email-template-editor" action={save}>
      <h2>{senderEmail ? "Replace connection" : "Connect Resend"}</h2>
      <p>Verify your sending domain in Resend, then create a sending-only API key for that domain.{senderEmail ? " Saving replaces the existing connection; the new connection remains unverified." : " Your connection remains unverified until you send and confirm a test email."}</p>
      {!configured ? <p role="status">Connection setup is temporarily unavailable. Contact your Waybook administrator to enable it.</p> : null}
      <label>Sender email<input name="senderEmail" type="email" maxLength={254} defaultValue={senderEmail ?? ""} autoComplete="email" disabled={!configured} required /></label>
      <label>Resend API key<input name="apiKey" type="password" autoComplete="off" maxLength={4096} disabled={!configured} required /></label>
      <p>The API key is encrypted and will not be shown again.{!deliveryEnabled ? " Automatic booking emails are not enabled yet." : ""}</p>
      <button type="submit" disabled={!configured}>Save connection</button>
    </form>
  </div>;
}
