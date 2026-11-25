import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge, EnvBadge, StrengthBadge, RoleBadge } from '@/components/common/badges';

describe('semantic badges', () => {
  it('renders host status and env labels', () => {
    render(
      <div>
        <StatusBadge status="online" />
        <StatusBadge status="offline" />
        <EnvBadge env="prod" />
        <StrengthBadge strength="weak" />
        <RoleBadge role="operator" />
      </div>,
    );
    expect(screen.getByText('在线')).toBeInTheDocument();
    expect(screen.getByText('离线')).toBeInTheDocument();
    expect(screen.getByText('生产')).toBeInTheDocument();
    expect(screen.getByText('弱')).toBeInTheDocument();
    expect(screen.getByText('运维')).toBeInTheDocument();
  });
});
