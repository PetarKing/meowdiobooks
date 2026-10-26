import { createContext } from 'react';

export type HomeSceneDirection = 'hybrid-dithercn' | 'hybrid' | 'wide-sky' | 'moonrise' | 'storybook';
/** A visual experiment seam; commands and workflow state remain in the page model. */
export const HomeSceneDirectionContext = createContext<HomeSceneDirection>('hybrid-dithercn');
