import type { Meta, StoryObj } from '@storybook/react-vite';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from './select';

const meta = {
  title: 'Components/Select',
  component: Select,
  tags: ['autodocs'],
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Select defaultValue="opened">
      <SelectTrigger className="w-56">
        <SelectValue placeholder="Pick an event" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="opened">Email Opened</SelectItem>
        <SelectItem value="clicked">Email Link Clicked</SelectItem>
        <SelectItem value="converted">Converted</SelectItem>
      </SelectContent>
    </Select>
  ),
};

export const Grouped: Story = {
  render: () => (
    <Select>
      <SelectTrigger className="w-56" size="sm">
        <SelectValue placeholder="Attribution model" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Single touch</SelectLabel>
          <SelectItem value="first">First touch</SelectItem>
          <SelectItem value="last">Last touch</SelectItem>
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Multi touch</SelectLabel>
          <SelectItem value="linear">Linear</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
};
