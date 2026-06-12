import { OnboardingChecklist } from '@/components/dashboard/onboarding-checklist';
import { DashboardOverview } from '@/components/dashboard/overview';

export default function DashboardPage() {
  return (
    <div className="bg-radiant -m-6 grid gap-4 p-6">
      <OnboardingChecklist />
      <DashboardOverview />
    </div>
  );
}
