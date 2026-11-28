import Image from "next/image";

export type PaymentProviderStatus = { label: string; tone?: "positive" | "attention" };

export function PaymentProviderRow({ id, name, description, logo, darkLogo, statuses, actions, children }: {
  id: string;
  name: string;
  description: string;
  logo: string;
  darkLogo?: string;
  statuses: PaymentProviderStatus[];
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return <section className="payment-provider" aria-labelledby={id}>
    <div className="payment-provider__row">
      <span className={`payment-provider__logo payment-provider__logo--${id}`}>
        <Image className={darkLogo ? "payment-provider__logo-light" : undefined} src={logo} alt="" width={54} height={30} unoptimized />
        {darkLogo ? <Image className="payment-provider__logo-dark" src={darkLogo} alt="" width={54} height={30} /> : null}
      </span>
      <div className="payment-provider__identity">
        <h3 id={id}>{name}</h3>
        <span>{description}</span>
      </div>
      <div className="payment-provider__statuses" role="status">
        {statuses.map(({ label, tone }) => <span key={label} className="payment-provider__badge" data-tone={tone}>{label}</span>)}
      </div>
      {actions ? <div className="payment-provider__actions">{actions}</div> : null}
    </div>
    {children ? <div className="payment-provider__feedback">{children}</div> : null}
  </section>;
}

export const stripeBrand = { logo: "/brand/stripe-blurple.svg", darkLogo: "/brand/stripe-white.svg" };
