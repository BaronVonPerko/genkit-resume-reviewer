import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./review-page').then((module) => module.ReviewPage),
  },
];
