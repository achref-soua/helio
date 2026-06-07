import type { Meta, StoryObj } from '@storybook/react-vite';

import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

const meta = {
  title: 'Components/Tabs',
  component: Tabs,
  tags: ['autodocs'],
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Tabs defaultValue="overview" className="w-100">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="contacts">Contacts</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="text-muted-foreground text-sm">
        Campaign performance at a glance.
      </TabsContent>
      <TabsContent value="contacts" className="text-muted-foreground text-sm">
        Who entered, converted, or exited.
      </TabsContent>
      <TabsContent value="settings" className="text-muted-foreground text-sm">
        Sending windows, goals, and exit rules.
      </TabsContent>
    </Tabs>
  ),
};
