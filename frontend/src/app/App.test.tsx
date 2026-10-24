import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import treeJson from '@contract/fixtures/tree.json';
import { createApiClient } from '../features/api';
import { App } from './App';

describe('App', () => {
  it('рендерится и показывает пакеты из фикстуры дерева', async () => {
    render(<App client={createApiClient('http://localhost/api')} />);
    expect(screen.getByText('Java Blueprints')).toBeInTheDocument();
    const firstPackage = treeJson.packages[0]?.name ?? '';
    expect(await screen.findByText(firstPackage)).toBeInTheDocument();
  });
});
