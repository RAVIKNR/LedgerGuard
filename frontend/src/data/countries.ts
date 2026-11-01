export type CountryOption = {
  code: string
  name: string
  callingCode: string
  flag: string
  minDigits: number
  maxDigits: number
}

export const countries: CountryOption[] = [
  { code: 'IN', name: 'India', callingCode: '+91', flag: '🇮🇳', minDigits: 10, maxDigits: 10 },
  { code: 'US', name: 'United States', callingCode: '+1', flag: '🇺🇸', minDigits: 10, maxDigits: 10 },
  { code: 'CA', name: 'Canada', callingCode: '+1', flag: '🇨🇦', minDigits: 10, maxDigits: 10 },
  { code: 'GB', name: 'United Kingdom', callingCode: '+44', flag: '🇬🇧', minDigits: 9, maxDigits: 10 },
  { code: 'AU', name: 'Australia', callingCode: '+61', flag: '🇦🇺', minDigits: 9, maxDigits: 9 },
  { code: 'NZ', name: 'New Zealand', callingCode: '+64', flag: '🇳🇿', minDigits: 8, maxDigits: 10 },
  { code: 'SG', name: 'Singapore', callingCode: '+65', flag: '🇸🇬', minDigits: 8, maxDigits: 8 },
  { code: 'AE', name: 'United Arab Emirates', callingCode: '+971', flag: '🇦🇪', minDigits: 9, maxDigits: 9 },
  { code: 'SA', name: 'Saudi Arabia', callingCode: '+966', flag: '🇸🇦', minDigits: 9, maxDigits: 9 },
  { code: 'ZA', name: 'South Africa', callingCode: '+27', flag: '🇿🇦', minDigits: 9, maxDigits: 9 },
  { code: 'DE', name: 'Germany', callingCode: '+49', flag: '🇩🇪', minDigits: 10, maxDigits: 11 },
  { code: 'FR', name: 'France', callingCode: '+33', flag: '🇫🇷', minDigits: 9, maxDigits: 9 },
  { code: 'IT', name: 'Italy', callingCode: '+39', flag: '🇮🇹', minDigits: 9, maxDigits: 10 },
  { code: 'ES', name: 'Spain', callingCode: '+34', flag: '🇪🇸', minDigits: 9, maxDigits: 9 },
  { code: 'NL', name: 'Netherlands', callingCode: '+31', flag: '🇳🇱', minDigits: 9, maxDigits: 9 },
  { code: 'CH', name: 'Switzerland', callingCode: '+41', flag: '🇨🇭', minDigits: 9, maxDigits: 9 },
  { code: 'IE', name: 'Ireland', callingCode: '+353', flag: '🇮🇪', minDigits: 9, maxDigits: 9 },
  { code: 'BR', name: 'Brazil', callingCode: '+55', flag: '🇧🇷', minDigits: 10, maxDigits: 11 },
  { code: 'MX', name: 'Mexico', callingCode: '+52', flag: '🇲🇽', minDigits: 10, maxDigits: 10 },
  { code: 'AR', name: 'Argentina', callingCode: '+54', flag: '🇦🇷', minDigits: 10, maxDigits: 10 },
  { code: 'JP', name: 'Japan', callingCode: '+81', flag: '🇯🇵', minDigits: 9, maxDigits: 10 },
  { code: 'CN', name: 'China', callingCode: '+86', flag: '🇨🇳', minDigits: 11, maxDigits: 11 },
  { code: 'HK', name: 'Hong Kong', callingCode: '+852', flag: '🇭🇰', minDigits: 8, maxDigits: 8 },
  { code: 'KR', name: 'South Korea', callingCode: '+82', flag: '🇰🇷', minDigits: 9, maxDigits: 10 },
  { code: 'MY', name: 'Malaysia', callingCode: '+60', flag: '🇲🇾', minDigits: 9, maxDigits: 10 },
  { code: 'TH', name: 'Thailand', callingCode: '+66', flag: '🇹🇭', minDigits: 9, maxDigits: 9 },
  { code: 'ID', name: 'Indonesia', callingCode: '+62', flag: '🇮🇩', minDigits: 9, maxDigits: 12 },
  { code: 'PH', name: 'Philippines', callingCode: '+63', flag: '🇵🇭', minDigits: 10, maxDigits: 10 },
  { code: 'PK', name: 'Pakistan', callingCode: '+92', flag: '🇵🇰', minDigits: 10, maxDigits: 10 },
  { code: 'BD', name: 'Bangladesh', callingCode: '+880', flag: '🇧🇩', minDigits: 10, maxDigits: 10 },
  { code: 'LK', name: 'Sri Lanka', callingCode: '+94', flag: '🇱🇰', minDigits: 9, maxDigits: 9 },
  { code: 'NG', name: 'Nigeria', callingCode: '+234', flag: '🇳🇬', minDigits: 10, maxDigits: 10 },
  { code: 'KE', name: 'Kenya', callingCode: '+254', flag: '🇰🇪', minDigits: 9, maxDigits: 9 },
  { code: 'EG', name: 'Egypt', callingCode: '+20', flag: '🇪🇬', minDigits: 10, maxDigits: 10 },
  { code: 'TR', name: 'Türkiye', callingCode: '+90', flag: '🇹🇷', minDigits: 10, maxDigits: 10 },
  { code: 'IL', name: 'Israel', callingCode: '+972', flag: '🇮🇱', minDigits: 9, maxDigits: 9 },
  { code: 'UA', name: 'Ukraine', callingCode: '+380', flag: '🇺🇦', minDigits: 9, maxDigits: 9 },
  { code: 'RU', name: 'Russia', callingCode: '+7', flag: '🇷🇺', minDigits: 10, maxDigits: 10 }
]
