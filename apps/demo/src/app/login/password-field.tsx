"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

export function PasswordField() {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;

  return (
    <div className="waybook-login-password">
      <label htmlFor="login-password">Password</label>
      <div className="waybook-login-password__field">
        <input
          id="login-password"
          name="password"
          type={visible ? "text" : "password"}
          autoComplete="current-password"
          placeholder="Enter your password"
          required
        />
        <button type="button" aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible(!visible)}>
          <Icon size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
