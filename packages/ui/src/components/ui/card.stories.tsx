import type { Meta, StoryObj } from '@storybook/react-vite';

import { Badge } from './badge';
import { Button } from './button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card';

const meta = {
  title: 'Components/Card',
  component: Card,
  tags: ['autodocs'],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CampaignSummary: Story = {
  render: () => (
    <Card className="w-90">
      <CardHeader>
        <CardTitle>Welcome series</CardTitle>
        <CardDescription>Trial-signup onboarding journey</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-2">
        <Badge>active</Badge>
        <span className="text-muted-foreground text-sm">3 steps · 1,248 contacts entered</span>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="outline" size="sm">
          Pause
        </Button>
        <Button size="sm">View report</Button>
      </CardFooter>
    </Card>
  ),
};
