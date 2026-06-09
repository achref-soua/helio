import react from '@helio/config/eslint/react';
import next from '@next/eslint-plugin-next';

export default [
  ...react,
  next.configs['core-web-vitals'],
  {
    ignores: ['.next/', '.source/'],
  },
];
