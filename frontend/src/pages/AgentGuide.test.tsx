import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentGuide, type AgentGuideEdition } from './AgentGuide';
import { changeAppLocale } from '../i18n';

afterEach(async () => {
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
  await changeAppLocale('en');
});

describe('browser agent guide', () => {
  it('shows script guidance first and exposes the full guide in one action', () => {
    const { container } = render(<AgentGuide />);
    const topics = Array.from(container.querySelectorAll('details'));
    expect(topics).toHaveLength(6);
    expect(topics.filter(topic => topic.open).map(topic => topic.id)).toEqual(['clean-script']);
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(topics.every(topic => topic.open)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(topics.every(topic => !topic.open)).toBe(true);
  });

  it('pauses the background on request and while the tab is hidden', () => {
    const visibility = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const { container } = render(<AgentGuide />);
    const scene = container.querySelector('.guide-scene')!;
    expect(scene.getAttribute('data-paused')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Pause background animation' }));
    expect(scene.getAttribute('data-paused')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Resume background animation' }));
    expect(scene.getAttribute('data-paused')).toBe('false');
    visibility.mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    expect(scene.getAttribute('data-paused')).toBe('true');
  });

  it('opens a directly linked topic without a workflow or account', () => {
    window.history.replaceState({}, '', '/for-agents#background-jobs');
    const { container } = render(<AgentGuide />);
    expect(container.querySelector<HTMLDetailsElement>('#background-jobs')?.open).toBe(true);
    expect(screen.getAllByRole('link', { name: /Back to the studio/ })).toHaveLength(1);
  });

  it('replaces local job and storage claims with supplied edition policy', () => {
    const policy = { jobs: 'Hosted jobs continue.', storage: 'Hosted retention applies.', costs: 'Check the quote.' };
    const edition: AgentGuideEdition = { en: policy, 'zh-CN': policy };
    render(<AgentGuide edition={edition} />);
    expect(screen.getByText(policy.jobs)).toBeTruthy();
    expect(screen.getByText(policy.storage)).toBeTruthy();
    expect(screen.getByText(policy.costs)).toBeTruthy();
    expect(screen.queryByText(/Working books and Library exports are stored locally/)).toBeNull();
    expect(screen.queryByText(/AI cleanup Review and any selected remote processing/)).toBeNull();
  });

  it('keeps topic anchors and localized navigation in Chinese', async () => {
    await changeAppLocale('zh-CN');
    const { container } = render(<AgentGuide />);
    fireEvent.click(screen.getByRole('button', { name: '全部展开' }));
    expect(container.querySelector<HTMLDetailsElement>('#review')?.open).toBe(true);
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(screen.getByRole('heading', { level: 1, name: '智能体指南' })).toBeTruthy();
  });
});
