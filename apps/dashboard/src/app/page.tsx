import { Dashboard } from "@/components/dashboard";

const DEFAULT_PAYOUTS_URL = "https://github.com/Josefusan/agenttoll/blob/main/docs/PAYOUTS.md";
const DEFAULT_GATEWAY_URL = "http://localhost:8402";

export default function Page() {
  return (
    <Dashboard
      payoutsUrl={process.env.NEXT_PUBLIC_PAYOUTS_URL ?? DEFAULT_PAYOUTS_URL}
      gatewayUrl={process.env.NEXT_PUBLIC_GATEWAY_URL ?? DEFAULT_GATEWAY_URL}
    />
  );
}
