type FormToggleProps = {
  name: string;
  label: string;
  defaultChecked?: boolean;
  disabled?: boolean;
  value?: string;
  description?: string;
};

/** A native checkbox with switch semantics for one independent on/off setting.
 * Multi-select assignment fields deliberately remain checkboxes. */
export function FormToggle({ name, label, defaultChecked = false, disabled = false, value, description }: FormToggleProps) {
  return <label className="waybook-form-toggle">
    <input type="checkbox" role="switch" name={name} value={value} defaultChecked={defaultChecked} disabled={disabled} />
    <span aria-hidden="true" />
    <span><b>{label}</b>{description ? <small>{description}</small> : null}</span>
  </label>;
}
