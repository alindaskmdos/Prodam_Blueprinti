import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import treeJson from '@contract/fixtures/tree.json';
import { createApiClient } from '../api';
import { server } from '../../mocks/server';
import { resetAppState, useAppStore } from '../../app/store';
import { ProjectTree } from './ProjectTree';

const client = createApiClient('http://localhost/api');
const pkg = treeJson.packages[0];
const cls = pkg?.files[0]?.classes[0];
const method = cls?.methods[0];
const field = cls?.fields[0];
if (!pkg || !cls || !method || !field) throw new Error('tree.json: нужен пакет с классом, полем и методом');

describe('ProjectTree', () => {
  beforeEach(() => resetAppState());

  it('показывает пакеты, классы, поля и методы из tree.json с бейджем сложности', async () => {
    render(<ProjectTree client={client} projectId="p-1" />);

    expect(await screen.findByText(pkg.name)).toBeInTheDocument();
    expect(screen.getByText(cls.name)).toBeInTheDocument();
    expect(screen.getByText(field.name)).toBeInTheDocument();
    expect(screen.getByText(method.name)).toBeInTheDocument();
    expect(screen.getByText(method.complexity)).toBeInTheDocument();
    expect(screen.getByText('1 файл')).toBeInTheDocument();
    expect(useAppStore.getState().version).toBe(treeJson.version);
  });

  it('клик по методу кладёт его id в общее состояние', async () => {
    render(<ProjectTree client={client} projectId="p-1" />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(method.name) }));
    expect(useAppStore.getState().selectedMethodId).toBe(method.id);
  });

  it('пакет сворачивается кликом', async () => {
    render(<ProjectTree client={client} projectId="p-1" />);
    const pkgButton = await screen.findByRole('button', { name: new RegExp(pkg.name) });
    expect(pkgButton).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(pkgButton);
    expect(pkgButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(cls.name)).not.toBeInTheDocument();
  });

  it('ошибка загрузки показывается сообщением', async () => {
    server.use(
      http.get('*/api/projects/:projectId/tree', () =>
        HttpResponse.json({ code: 'NOT_FOUND', message: 'проект не найден' }, { status: 404 }),
      ),
    );
    render(<ProjectTree client={client} projectId="nope" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('проект не найден');
  });
});
