import { OnboardingChecklist } from '@/components/dashboard/onboarding-checklist';
import { DashboardOverview } from '@/components/dashboard/overview';

export default function DashboardPage() {
  return (
    <div className="grid gap-4">
      <OnboardingChecklist />
      <DashboardOverview />
    </div>
  );
}
