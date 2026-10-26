import { createContext } from 'react';

export type HomeSceneDirection = 'wide-sky' | 'moonrise' | 'storybook';
/** A visual experiment seam; commands and workflow state remain in the page model. */
export const HomeSceneDirectionContext = createContext<HomeSceneDirection>('wide-sky');
