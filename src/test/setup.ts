import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

afterEach(() => cleanup());

// jsdom ne implementira scrollTo (aplikacija ga zove pri promjeni zaslona)
if (typeof window !== 'undefined') window.scrollTo = () => undefined;

// paralelno izvođenje datoteka opterećuje CPU: zadani waitFor od 1 s daje povremene lažne istekove
configure({ asyncUtilTimeout: 4000 });
