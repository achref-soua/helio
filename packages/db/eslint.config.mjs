import base from '@helio/config/eslint/base';

export default [
  ...base,
  {
    ignores: ['src/generated/'],
  },
];
