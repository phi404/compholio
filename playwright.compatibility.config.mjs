import { defineConfig, devices } from '@playwright/test';
import config from './playwright.config.mjs';
export default defineConfig({
  ...config,testDir:'./tests/compatibility',timeout:90000,
  projects:[
    ...['chromium','firefox','webkit'].map(browserName=>({name:browserName,testIgnore:'**/mobile.spec.mjs',use:{browserName}})),
    {name:'ios-webkit',testMatch:['**/typography.spec.mjs','**/mobile.spec.mjs','**/sample.spec.mjs','**/appearance.spec.mjs'],use:{...devices['iPhone 13'],browserName:'webkit'}},
    {name:'android-chromium',testMatch:['**/typography.spec.mjs','**/mobile.spec.mjs','**/sample.spec.mjs','**/appearance.spec.mjs'],use:{...devices['Pixel 7'],browserName:'chromium'}},
  ],
});
