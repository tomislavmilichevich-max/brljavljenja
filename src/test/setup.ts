import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());

// jsdom ne implementira scrollTo (aplikacija ga zove pri promjeni zaslona)
if (typeof window !== 'undefined') window.scrollTo = () => undefined;
