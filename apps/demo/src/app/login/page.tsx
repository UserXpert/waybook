import { login } from "./actions";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const error = (await searchParams).error;
  return <main className="waybook-initializing"><p>WAYBOOK CONTROL</p><h1>Sign in to Waybook.</h1><form action={login} className="waybook-login"><label>Email<input name="email" type="email" required /></label><label>Password<input name="password" type="password" required /></label>{error && <span role="alert">Invalid email or password.</span>}<button type="submit">Sign in</button></form></main>;
}
