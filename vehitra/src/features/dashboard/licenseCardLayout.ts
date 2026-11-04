export const LICENSE_FRONT = require('../../../assets/license_front.jpg');
export const LICENSE_BACK = require('../../../assets/license_back.jpg');

export const TEMPLATE_WIDTH = 2400;
export const TEMPLATE_HEIGHT = 1792;
export const CARD_ASPECT_RATIO = TEMPLATE_WIDTH / TEMPLATE_HEIGHT;

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
    photo: ImageOverlayConfig;
  };
};

export const licenseCardLayout: LicenseCardLayout = {
  front: {
    portrait: {
      left: 5.5,
      top: 27,
      width: 25,
      height: 64,
    },
    fields: {
      fullName: { left: 33, top: 30, width: 58, fontSize: 13, lineHeight: 16, color: '#000000', fontWeight: '800', numberOfLines: 2 },
      nationality: { left: 33, top: 40, width: 16, fontSize: 12, color: '#000000', fontWeight: '800' },
      sex: { left: 50.5, top: 40, width: 10, fontSize: 12, color: '#000000', fontWeight: '800' },
      dateOfBirth: { left: 58.3, top: 40.4, width: 16, fontSize: 10, color: '#000000', fontWeight: '800' },
      weight: { left: 77, top: 40, width: 12, fontSize: 12, color: '#000000', fontWeight: '800' },
      height: { left: 89, top: 40, width: 12, fontSize: 12, color: '#000000', fontWeight: '800' },
      address: { left: 33, top: 51, width: 58, fontSize: 11, lineHeight: 13, color: '#000000', numberOfLines: 2, fontWeight: '800' },
      licenseNumber: { left: 33, top: 64, width: 26, fontSize: 12, color: '#000000', fontWeight: '800' },
      expirationDate: { left: 59.7, top: 64, width: 18, fontSize: 12, color: '#000000', fontWeight: '800' },
      agencyCode: { left: 84, top: 64, width: 16, fontSize: 12, color: '#000000', fontWeight: '800' },
      bloodType: { left: 37, top: 75, width: 14, fontSize: 12, color: '#000000', fontWeight: '800' },
      eyeColor: { left: 49.5, top: 75, width: 14, fontSize: 12, color: '#000000', fontWeight: '800' },
      licenseCodes: { left: 37, top: 86, width: 14, fontSize: 12, color: '#000000', fontWeight: '800' },
      conditions: { left: 49.5, top: 86, width: 20, fontSize: 11, color: '#000000', numberOfLines: 2, fontWeight: '800' },
    },
  },

  back: {
    photo: {
      left: 3,
      top: 4,
      width: 12,
      height: 19,
      borderRadius: 0,
    },
    fields: {
      // DL Codes list: top-right / upper section
      licenseCodes: {
        left: 26,
        top: 3,
        width: 68,
        fontSize: 9,
        lineHeight: 11,
        color: '#000000',
        numberOfLines: 9,
      },

      // Separate DL Code value. Positioned below the DL Codes list.
      dlCode: {
        left: 65,
        top: 7,
        width: 25,
        fontSize: 5,
        color: '#000000',
      },

      // Serial Number: right-middle
      serialNumber: {
        left: 78,
        top: 42,
        width: 20,
        fontSize: 12,
        color: '#000000',
        fontWeight: '900',
      },

      // Keep these fields available for later positioning if needed.
      address: {
        left: 26,
        top: 63,
        width: 46,
        fontSize: 9,
        lineHeight: 11,
        color: '#000000',
        numberOfLines: 2,
      },
      conditions: {
        left: 26,
        top: 36,
        width: 46,
        fontSize: 9,
        lineHeight: 11,
        color: '#000000',
        numberOfLines: 3,
      },
      licenseNumber: {
        left: 72,
        top: 31,
        width: 25,
        fontSize: 10,
        color: '#000000',
      },
      agencyCode: {
        left: 72,
        top: 34,
        width: 25,
        fontSize: 10,
        color: '#000000',
      },
      expirationDate: {
        left: 26,
        top: 76,
        width: 18,
        fontSize: 10,
        color: '#000000',
      },
    },
  },
};