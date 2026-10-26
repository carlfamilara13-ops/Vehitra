import { Image } from 'react-native';

export const LICENSE_FRONT = require('../../../assets/license_front.jpg');
export const LICENSE_BACK = require('../../../assets/license_back.jpg');

// Source image dimensions
export const TEMPLATE_WIDTH = 2400;
export const TEMPLATE_HEIGHT = 1792;
export const CARD_ASPECT_RATIO = TEMPLATE_WIDTH / TEMPLATE_HEIGHT; // ~1.339

export type TextOverlayConfig = {
  left: number;
  top: number;
  width?: number;
  fontSize?: number;
  lineHeight?: number;
  color?: string;
  fontWeight?: string | number;
  textAlign?: 'left' | 'center' | 'right';
  numberOfLines?: number;
  letterSpacing?: number;
};

export type ImageOverlayConfig = {
  left: number;
  top: number;
  width: number;
  height: number;
  borderRadius?: number;
};

export type LicenseCardLayout = {
  front: {
    fields: Record<string, TextOverlayConfig>;
    portrait: ImageOverlayConfig;
  };
  back: {
    fields: Record<string, TextOverlayConfig>;
  };
};

// Layout calibrated from PH LTO-style template - adjust as needed for exact alignment
export const licenseCardLayout: LicenseCardLayout = {
  front: {
    portrait: {
      left: 5.5,
      top: 27,
      width: 25.0,
      height: 64.0,
    },
    fields: {
      fullName: { left: 33, top: 30, width: 58.0, fontSize: 13, lineHeight: 16, color: '#000000', fontWeight: '800', numberOfLines: 2 },
      nationality: { left: 33, top: 40.0, width: 16.0, fontSize: 12, color: '#000000', fontWeight: '800' },
      sex: { left: 50.5, top: 40.0, width: 10.0, fontSize: 12, color: '#000000', fontWeight: '800' },
      dateOfBirth: { left: 58.3, top: 40.4, width: 16.0, fontSize: 10, color: '#000000', fontWeight: '800' },
      weight: { left: 77,   top: 40.0, width: 12.0, fontSize: 12, color: '#000000', fontWeight: '800' },
      height: { left: 89,   top: 40.0, width: 12.0, fontSize: 12, color: '#000000', fontWeight: '800' },
      address: { left: 33, top: 51.0, width: 58.0, fontSize: 11, lineHeight: 13, color: '#000000', numberOfLines: 2, fontWeight: '800' },
      licenseNumber: { left: 33, top: 64, width: 26.0, fontSize: 12, color: '#000000', fontWeight: '800' },
      expirationDate: { left: 59.7, top: 64, width: 18.0, fontSize: 12, color: '#000000', fontWeight: '800' },
      agencyCode: { left: 84, top: 64, width: 16.0, fontSize: 12, color: '#000000', fontWeight: '800' },
      bloodType: { left: 37, top: 75, width: 14.0, fontSize: 12, color: '#000000', fontWeight: '800' },
      eyeColor: { left: 49.5, top: 75, width: 14.0, fontSize: 12, color: '#000000', fontWeight: '800' },
      licenseCodes: { left: 37, top: 86, width: 14.0, fontSize: 12, color: '#000000', fontWeight: '800' },
      conditions: { left: 49.5, top: 86, width: 20.0, fontSize: 11, color: '#000000', numberOfLines: 2, fontWeight: '800' },
    },
  },
  back: {
    fields: {
      address: { left: 26.0, top: 41.5, width: 46.0, fontSize: 10, lineHeight: 12, color: '#000000', numberOfLines: 2 },
      licenseNumber: { left: 26.0, top: 61.5, width: 24.0, fontSize: 12, color: '#000000' },
      expirationDate: { left: 52.0, top: 61.5, width: 18.0, fontSize: 12, color: '#000000' },
      agencyCode: { left: 78.0, top: 61.5, width: 16.0, fontSize: 12, color: '#000000' },
      licenseCodes: { left: 26.0, top: 3.5, width: 40.0, fontSize: 9, lineHeight: 11, color: '#000000', numberOfLines: 6 },
      conditions: { left: 26.0, top: 41.5, width: 46.0, fontSize: 10, lineHeight: 12, color: '#000000', numberOfLines: 2 },
    },
  },
};
