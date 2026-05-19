import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function svg(d: string) {
  return function IconComponent(props: IconProps) {
    return (
      <svg
        width="1em"
        height="1em"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...props}
      >
        <path d={d} />
      </svg>
    );
  };
}

export const PlusIcon = svg('M8 3.5v9M3.5 8h9');
export const CheckIcon = svg('M3.5 8.3l3 3 6-6.6');
export const CloseIcon = svg('M4 4l8 8M12 4l-8 8');
export const SearchIcon = svg('M11.5 11.5L14 14M7 12.5a5.5 5.5 0 100-11 5.5 5.5 0 000 11z');
export const TrashIcon = svg('M3 4.5h10M6.5 4.5V3a1 1 0 011-1h1a1 1 0 011 1v1.5M5 4.5l.7 8a1 1 0 001 .9h2.6a1 1 0 001-.9l.7-8');
export const RestoreIcon = svg('M3 8a5 5 0 109-3M3.5 3v3h3');
export const ClipboardIcon = svg('M5.5 3.5h-1a1 1 0 00-1 1v8a1 1 0 001 1h7a1 1 0 001-1v-8a1 1 0 00-1-1h-1M5.5 3.5a1 1 0 011-1h3a1 1 0 011 1v1h-5v-1z');
export const CanvasIcon = svg('M2.5 3.5h11v9h-11zM5.5 6.5h2.5v3h-2.5zM10 6.5h.5M10 9h.5');
export const ListIcon = svg('M5.5 4h8M5.5 8h8M5.5 12h8M3 4h.01M3 8h.01M3 12h.01');
export const DownloadIcon = svg('M8 2.5v8.5M4.5 8L8 11.5 11.5 8M3 13.5h10');
export const UploadIcon = svg('M8 11.5V3M4.5 6L8 2.5 11.5 6M3 13.5h10');
export const ClockIcon = svg('M8 4v4l2.5 1.5M8 14a6 6 0 100-12 6 6 0 000 12z');
export const SparkleIcon = svg('M8 2.5v3M8 10.5v3M2.5 8h3M10.5 8h3M4 4l2 2M10 10l2 2M4 12l2-2M10 6l2-2');
export const InboxIcon = svg('M2.5 3.5h11l-1.5 6h-2.5l-1 1.5h-2l-1-1.5h-2.5l-1.5-6zM2.5 3.5v9h11v-9');

export function LogoIcon(props: IconProps) {
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <rect x="2" y="2" width="12" height="12" rx="3" fill="currentColor" opacity="0.18" />
      <rect x="2" y="2" width="6.5" height="6.5" rx="2" fill="currentColor" />
      <rect x="9" y="9" width="5" height="5" rx="1.6" fill="currentColor" opacity="0.85" />
    </svg>
  );
}
