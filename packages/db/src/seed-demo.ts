import {
  availabilitySchema,
  DEFAULT_AVAILABILITY,
  emailDocumentSchema,
  journeyDefinitionSchema,
  landingDocumentSchema,
  newId,
  segmentRuleSchema,
} from '@helio/core';

import type { PrismaClient } from './client';
import { type Prisma } from './generated/prisma/client';

/** A small amber-dawn hero PNG (300×120, generated, ~9 KB) used by the
 *  seeded product-update template to show off image blocks. Stored as an
 *  EmailAsset so the demo exercises the real upload/serve pipeline. */
const HERO_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAASwAAAB4CAIAAADHd1h3AAAkfUlEQVR42u2VhXdV+Zqm9/8wa1ZPT/f0lBtxdxfiIQoEh6KoKqQowV2TkEDc3d0hQHB3DW6BKIS4ECAh8+zsJAVz6xa37Z7uxW+tZ9Uqztn7+9735f040rMoTcF7iNZqjdF+HqPTFqvbFqfXHq/fkWDQmWgIXUlG3cnG3SkmPammvalmvWnmfekW/RmW8CLT6kWW9UC2zcts25c5dq9ywf51ngMM5jsOFUwcKnB6UwjOb4qch4tchotdZUrcZErdRynzGKXc8y0mDVf8dfj27YfHJ4zPVFYo64pc2C5rKHRCD6rQpohELZpRjn5c4AVHijU84hS/uMY7CZCDEgjJkA8pkRWJkRvpiQr9OVJLhIbgT3gaSUzardH0Sfd5rF5bHA3Tb4836Eigc0adScZdySbdKXSRRpr3pln0pdNRykplKa7NQBYNpsoUmlpTbsfX+RTdaVBuvPNQITcA3IObTIm7TKmHTJnnCMpRgZdMhYL3+xh5THlFeZ05ykBluLJoZCnb0YAS9KAKbShEpyIY5ejHBV5whC/c4RGn+MU13kmAHEiDTEhGiYisSIzcSI8MRZH+BKkpXEPwhzRHaDZHarXQIZoUrdsao9caq/88zqAt3rA9wag90bgjifKZdiabdaWYd6da9KRZ9qRb9aZb92XY9GXa9mfZvcgG+4Ech5e5ji/zJr7Ko9/Or+WuuwwWug4VucGbYvc3xVwFt+EpI1+LcjzeMhU+o1T6/k6V33t4++HxCcpAJjOfLcq6Eg+2o0ERgyq0oRCdqEUzytGPC7zgCF+4wyNO8YtrvJMAOZAGmZAM+ZASWZEYuZEeGZIkeYpS/SFSQ5iG4C9pDNdsitBqjtRpjtJtidZ7GqP/LNbgWZxha7zR83jjtgQKZ9qeZNaRbN6ZYtGVatmVZtWdRjVtejJsezPt+rLs+7Md+rMdX+Q4DuROHKDQ1Drf5VWB6+tCNxgsch8q9hgq9nxT4vmmlJNQboMj8ZGp8JWp9JOp8h9h8vDucabI7PkjlK/Gn+Qt5XVllDJWWcEuNpZ6sR0NKEEPqhR56EQtmlGOflzgBUf4wh0ecYpfXOOdBMiBNMiEZMiHlMiKxMiN9MiQJMmTVEW1/hLpyS4Nwbto1odpNYRrN0boNEXqNkXpNUfrt8QYPI01fBZn9IyG0TPalmTenmzRnmzZkWLVmUodbbrSbbsz7Hoy7XuzHHqzHPuyJ/bnTOzPdXqR5zwgF9r1ZYHbq0L3V0Uer4s8B4s9B0smDZV4DZV6vynjJDgMLsRPppKbUe5HuaipMnsgQKYapr2PgNGH90wdfZ05TGMmk5mvLGJjmQ/b0YAS9KAKbShEJ2rRjHL04wIvOMIX7vCIU/ziGu8kQA6kQSYkQz6kRFYkRm6kR4YkSZ6kSrYkLGr2NtLjnRqC36EfYVr14doN4TqNEbpNkXpNUfrN0QYtMVSKYlEvSmb2PNG8LUm+wPYUq45U607lAtPtujPsezJHL7Avx6k/1/lFnstAHlV2e1ng/qrQ41URLafrNN5bPr9SboCfJk7CX0a+EE5FORvlipSjmi6zd8YYM4f3/XX4dvxJ5UUmMIdpzGQy89nCLmVpuR8aUIIeVKENhehELZpRjn5c4AVHyh3iEaf4xTXeSaB95A7JhGTIh5TIisTIjfTIkCTJk1TJloTJWZRtHOlRqIZglJ2adbu0HodpP6ErNCZCryFSvzHKsCnaqDnGuCXW5Gmc6dN4s2cJ5q2JFs+TLNuSKZ9Ne6ptR5pdZ7p9V4ZDd6Zjd9bEnmyn3mwq69KX69qf5/Yi332gwGOg0POlXG6v18Xer0t8Bkt9h8r84E05lzBye5Wch3InHMx0mWquSDmqWcP7YPbwfoU5o9S8y/jnymM8z1u8ywTmME0Zy3y2sKty5BorJqNBEYMqtKEQnahFM8rRjwu84AhfuMMjTvGLa7yTADmQBpmQDPmQElmRGLmRHhmSJHmSKtmSMDmTtqicgvQgREMwgubDUJpBP2gJXdF7EqFfH2nYEGXUGG3cFGPSHGvaEmfWEm/+NMHiWaJVa5L182SbthTbtlS79jT7jnSHzgzHrsyJXVlO3dkuPTmuvblufXnuffke/fmeLwootNdAkffLYp9XJb6vS/1el/kPlk0eKp8yVDHljXJ+VdwGRzJDpnrk8PYqh6Tc1dzhGpgnc+Db96A8xvO8xbtMYA7TmMlkZQW72FgVwHY0oAQ9qEIbCtGJWjSjHP24wAuO8IU7POIUv7jGOwmQA2mQCcmQDymRFYmRG+mRIUmSJ6mSLQmTM2mTuSgeSPd2aAjgPoUI1X64U+fRLt1HYXp14fqPIwyeRBrVRxk3RJs0xpg2xpo1xZk3x1u0JFg9TbR+lmTTmmzbmmL3PNW+Lc2hPd2xI8OpM9O5M8ulK9u1O8etJ9e9N8+jjwbTY9pMp2l2se/LEr9XpdR9ymt6XzF1qDLgTdW0N1X8QHEb/F5xJ1yLcjmckHJOnNZ8mYPfjbFg+NAfwefjzyiv1IzcJHOYxkwmM58t7No9g71sRwNK0IMqtKEQnahFM8rRjwu84AhfuMMjTvGLa7yTADmQBpmQDPmQElmRGLmRHhmSJHmSKtmSMDmTNpmL4oF0J1hdcJcsKESo1n3KQUUoSrh+XYTBY/79pkDUiDJRqTjzpniL5gSrlkTrpxSO2lG+VPvnaQ5t6RPbM5w6qCYFzXbtynHrznXvyfPozZ/UW+DVV+jdX+TzgmbT71L/l2WTX9H48qmDFQGDldOGuATu4Z0LHDm//ePn9/bhfT98GH4Y5cgY45/wLc+MH+SB70ZPcf/YKY7dIRvZy3Y0oAQ9qEIbCtGJWjSjHP24wAuO8IU7POIUv7jGOwmQA2mQCcmQDymRFYmRG+mRIUmSJ6mSLQmTM2mTOcmL+km3g9QFd4JpA53Qvh+qHKH+w3CDRxGGdfz7PXqEZg2x5o1xFk3xlk38S59o05Jk+zTZ7lmKfWuqw/M0x7Z0p7YM5/ZMl44s185st64c9+5cj568ST35Xr0F3n2FPv1Fvi+K/QZK/Af4qSmj7gGvK6YNVk4frJoxtJtj4KeJw+CXit8rroWfLy5n5IQOjhzeIa7rR5kjC2WOLvqrKA8oD/MW7zKBOUxjJpOZzxZ27ZnNXrajASXoQRXaUIhO1KIZ5ejHBV5whC/c4RGn+MU13kmAHEiDTEimST5CS7IiMXIjPTIkSfIkVbKVjzBUh7TJnORF/aSbgeofOLeCNG5TBQoRonM3VPfeTr37u/QfhBk8DKc3tMekLsr0cbTZkxiL+ljLhjirxnjrpkSb5iTblmT7lhSHp6mOz9ImtlLHDJe2TNf2LLeObPfOHI/OXM+uPK/ufO+eAp/eQt++Ir/+Yv/+kskvSqcOlAW8LJ/2qmL668oZg1UzB7kE7kG+QH6pOBJOhYPhcrifH8bOj9PixhbLHFsywk/Dx9+FT5SvlMd4/vDC0VNkDtOYyWTms2XvPDayl+1oQAl6UIU2FKITtWhGOfpxgRcc4Qt3eMQpfnGNdxIgB9IgE5IhH1IiKxIjN9IjQ5IkT1IlWxImZ9Imc5In/w+8gVLtdvUPnBuBGjeDtG4Fa9/eoXMnRPdOqN7dnQb3wgzvUxqqQ4GizOqizR/HWDyhWNQr3qYhwbYx0a4pyb452aElhRbSRefWdJfWDNfnme5tWR7t2Z4duZM687y68r27C3x7Cv16ivx7iyf3lUzpLw14UTZtoHz6y4oZrypnvqqa9Xr37ME9c4eq573Z+xcXeJAT4pD4feOuRg7v2NLh4z/LnPhllJO//P7/ylc8w5M8z1u8ywTmvHuH7GIje9mOBpSgB1VoQyE6UYtmlKMfF3jBEb5wh0ec4hfXeCcBciANMiEZ8iElsiIxciM9MiRJ8iRVsiVhciZtMid58v/AGyhd26b+gXN9u2ZtoNYNCkEtQvRuh+rfoSi7DO+GGd0LN7kfYfog0uxhlPmjaIu6GKvHsdZP4mzq423rE+waEh0akx2bqCBFpI7prs8y3Foz3Z9TU8qa49We692R59OZ79tV4NddSKdp9tS+koC+0mn9ZTNelM8cqJz1smr2q91zXu+ZN1j97dDe+UP7vnuzf8FwzffDB7jAhcOH+DXjN40fN46K0+LGOLZfh0/+JnNq2TsoH/Itz/Akz/MW7zKBOUxjZs33zGcLu9jIXrajASXoQRXaUIhO1KIZ5ejHBV5whC/c4RGn+MU13kmAHEiDTEiGfEiJrEiM3EiPDEmSPEmVbEmYnEmbzEme/D/wBkpXtqp/0GzTuEoJqEKQdm2wzo0dejdD9G+FGtzeaXhnl/GdMJO74ab3IszuR5o/iLJ8GG31KMa6jpJRtQT7emqX5NiQPLExxbkp1aU5zbUl3e1phvuzTM/WrEnPs73acrzbcn3a8/w6Cvw7KTS1ptwl03pLp/eVzein9BWzXlTOGaia+3L3vFd7vn1dPX9wLxfCnXAtPw4f4BeMnzJ+0N6+QC6Ne1s+fGrF8OmVw2fG4P/5hM/5lmfG75B3mcAcptX8yGTms4VdbGQv29GAEvSgCm0oRCdq0Yxy9OMCLzjCF+7wiFP84hrvJEAOpEEmJEM+pERWJEZupEeGJEmepEq2JEzOpE3mJE/+/C18yCWULm9R/6DZqnFlm+bV7VrXArWvB+nWBuvd2KF/M8TgVqjh7Z3Gd3aZ3AkzvRtudi/C/H6k5YMoq4cx1o9iberi7B7H2z9JcKhPdKxPmtiQ7NyY4tKU6tqc5taS7v40w/NZ5qTWLH43OELftjy/9nz/joLJnYVTuooCuoun9ZRM7y2d0Vc2s7989ouKOS8q5w5UzXu5+9tXe757Xb1gcN/3Q/t/eFPDD9ci+XgO8VPGDxoXxV3xK8dvHUe4YvgUh7dq+Mzq4XNr5f/y/3zC53zLMzzJ87zFu4eUI1zETCYzny3sYiN72Y4GlKAHVWhDITpRi2aUt8lH6IsXHOELd3jEKX5xjXcSIAfSIBOSIR9SIisSIzfSI0OSJE9SJVsSJmfSJnOSJ3/+Fj7kEkoXN6t/0GzRuLRV8/I2rSvbta8G6lwL0rserF+7w+BGiOHNUOObO01u7TK9HWZ2J9z8boTlvUir+1HWD2JsHsbaPoqzr4t3qEtwfJw48UmSc32yS0OKa2OqW1Oae3O6Z0vGpKeZXs+yvJ9l+7Tm+D3P82/Ln9xeMKWjcGpn0bSu4undJTN6Smf2lM3qLZ/TVzG3v3Lei6pvB3bPf7lnwavq71/v5VR+HNy/cKhm8ZuDS4YP8Wu2dOwO+ZXjzJYPn+B3b6V8eAr8P5/wOd/yzOgFLuVdJjCHacxkMvPZwi42spftaEAJelCFNhSiE7VoRjn6cYEXHOELd3jEKX5xjXcSIAfSIBOSIR9SIisSIzfSI0OSJE9SJVsSJmfSJnOSJ3/+Fj7kEkrnN6l94FzYrHFxi+albVqXt2tfCdS9GqR3jZbQFRpDb2jPLtNbYWa3w83vRFjejbS6F2V9P9rmfoztg1j7hzSP/iVOfJzk9CTZpT7FtSHVrZGOpns00VdaS3dpcI5va67/87zJbflT2gumthcGdBRN7yye0UXvaX/57N6KuX2V8/q5Cm5jz3cD1Qte7v3+FTfD5dQsGjyweOjgkjcH+U1bOnz45+Ejvwwf/VWGY3sb5UO+5ZlDS3met3iXCcxhGjOZzHy2sIuN7GU7GlCCHlShDYXoRC2aUY5+XOAFR/jCHR5xil9c450EyIE0yIRkyIeUyIrEyI30yJAkyZNUyZaEyZm0yZzkyf8Db6B0dqPaB865TernN2te2KJ1cSu10Lm0XfdyoP6VYIOrOwyvhRhdDzWu3Wl6Y5fZzTDzW+EWt+hWpPWdKJu70bb3Yuzux9o/iKOCFJE6OtcluTxOdnuS4l6f6tGQ7tmYMakp06s5y6cl27clx+8pnabZ+VOfFwS0FU5rL5reQe9LZnaWzuoqm9NdPrenYl5v5be9VfP7dn/Xv2fBi2pu5oeBvT++3Lfw1f5Fr2sWvz7AUf00eHDpEBz6Gd7AYfm/yh/5nG95hid5nrd4lwnMYRozmcx8trCLjexlOxpQgh5UoQ2F6EQtmlGOflzgBUf4wh0ecYpfXOOdBMiBNMiEZMiHlMiKxMiN9MiQJMmTVMmWhMmZtMmc5Mn/A2+gdHqD2gfOmY3qZzdpnKUNW7TPb9W5sE334na9S4H6l4MoDdUxvhpici3U9PpO89pdFjfCLG+GW92KtL4dZXMn2u5OjP3dWId7tJAuJjg/THR5lORal+z2mKbS17RJ9eleDRnejZk+TVm+zdl+zTn+LblTnuZNfZYf0Fow7Xnh9LaiGW3FM9tLZnWUzu4sm9tVPq+r/Nvuivk9lVzLgt7d3/ft+b6/+of+6h9f7F34Yt+iAdi/+KXMkpc178In+xfzLc/wJM/zFu8ygTlMYyaTmc8WdrGRvWxHA0rQgyq0oRCdqEUzytGPC7zgCF+4wyNO8YtrvJMAOZAGmZAM+ZASWZEYuZEeGZIkeZIq2ZIwOZM2mZM8+X/gDZROrVcTnN5AFSiE1rnNyh3qXdiufzHQ4FKQ4eVgoyvyHZpeCzVT7rA2zPJGuPXNCApnezvK7k60/d0Yh3ux1NHpfrzzgwSXh4muj5Lc6pLdH6d4Pk6d9CTNqz7duyHDpzHTtynLrynbvzlnSkvu1Kd5Ac/ypz0rmN5ayA1wCbPai7mKOR2lczvL5nXKpzKfm+mu/K6H+6nikH6Avj0/Qn/1wr+G8oDyMG/xbvfo7c1nJpOZzxZ2sZG9bEcDStCDKrShEJ2oRTPK0Y8LvOAIX7jDI07xi2u8kwA5kAaZkEzt7xdoRm6kR4YkSZ6kSrbyBW7WJm0yJ3lRP+nEOjXByfXqp2gDndikfWazztktuue26p3fpn9hu8HFQKOLQcaXgk0u7zC9EmJ2NdT82k7L67usasOsa8NtbkTY3oy0uxVlfzva8U7MxLuxTnfjnO/Fu9xPcH2Q6PYwyf1RsuejlEl1qV6P07yfpPvUZ/jWZ/o1ZPk3Zk9uyuYHZ2pzbkBL3rSn+dOfFsx4Jp/ErOdFs58Xz2krmQvtpfM6yr7tKON+4LvOiu+6KhZ0VcL33QpVY4z8sUtmAc/wpPx8+XzeZQJzlIFMZj5b2MVG9rIdDShBD6rQhkJ0ohbNKEc/LvCCI3zhDo84xS+u8U4C5EAaZEIy5ENKZEVi5EZ6ZEiS5EmqZEvC5EzaZE7yon7SsbVqAji+Tv3Ees2TG7RObdQ+tUnn9GbdM1v0zm41OLfN8Px2owuBxheCTC4Gm17aYXY5xOJKqOXVnVbXdllfC7O5Hm5bG2F3I9L+ZpTjreiJt2Kcbsc634lzuRvvei/B7X6i+/0kjweUmCpT6FTvujSfx+l+TzL8n2T612dNbqD6OVMbcwKacqc1501vzp/Rks95zHoq38nsZ0VzWoth7vOSeTKl37aNMr+tTKZ9DOWP8ucjD/Ck8grvMoE5TGMmk5nPFnaxkb1sRwNK0IMqtKEQnahFM8rRjwu84AhfuMMjTvGLa7yTADmQBpmQDPmQElmRGLmRHhmSJHmSKtmSMDmTNpmL4oF0ZI2aYAT1o2s1jq3TPL5e68QG7ZMbdU5u0j21Wf/0FoMzWw3PbjM6t934fKDJ+SDTC8FmF3dYXAqxvBxqdWWn9ZVdNlfDbK+F212PsK+NdKilmtFON2Ocb8W63I5zvR3vdife/W6Cx71Ez3tJk+4nez1I8X6Y6vMwzfdRml9dun8dvc+c/CRrypOsqfXZAQ0506Axd3pj3oymvJlN8sHMauZyCma3FMKcp1A09z0UzmmRmc1bvMsE5jCNmUxWVrCLjexlOxpQgh5UoQ2F6EQtmlGOflzgBUf4wh0ecYpfXOOdBMiBNMiEZMiHlMiKxMiN9MiQJMmTVMmWhMmZtMlcFA+kQ6vVBKOsUT9MM+gHLaErG3SOb9Q9sUn/5GaDU1sMT281OrPN+Mx2k7OBpueCzM4Hm1/YYXkxxOpiqPWlnTaXd9leCbO7Gm5/NcLhWqTj9ciJtVFOtdHON2Jcbsa63opzu0WVKXSC593ESXeTvO4le99P8YEHqb4PaT83kD75UcaUukyY+jgrAJ5kT3uSPb0+B2bU585oyJ3ZkCfTmDdrlPx3GftceYzneUt+N2c6c5imjGU+W9jFRvayHQ2KGFShDYXoRC2aUY5+XOAFR/jCHR5xil9c450EyIE0yIRkyIeUyIrEyI30yJAkyZNUyZaEyZm0ReUUpIMrJwh+ZxWhqB9ewz/S/FPNP9jax9brHN+ge2Ij/5Dzz7nhqS1Gp7can9lmcna76blAs3NB5ueDLZRrvBRifSnU5vJOfhn4fbC/Gu5wLWLkGiP56eAHhJ8R15uxbrdi3W/HedyO95QPMmHS3UR+c7zvJfvchxTfByl+D1M5DJgsn2X6lDouM2MqPM4MGINzmvbkj+Bz+duxJ5UX6+R7Gzm5tMny5FR/trCLjexlOxpQIh9evCfaUIhO1KIZ5eiXby/CEUf4wh0ecYrfsduzIAfSIBOSIR9SIisSIzfSI0OSJE9SJVsSJmdRtnGkmhUTBO+idmAlLaErNEbr8FrtI+t0jq7XPbZB7ziVoljUi5JtNTm9zfT0NrMz283PBtJCy3PBVud3WF8I4ZfB9mKo3aWd9pd32V8Oc7gSzk8HJXa6Ful8PcrlerRrbbTbjRi3G3LXPW7Ged6Kn3QbErzuJHrD3SSfu0m+d5N97yX73ZOvxV8mFSY/gDSY8jYP3/3jCPKT92X8ldeZwzRmypOTfJRFbGQv29GAEvSgCm0oRCdq0Yxy9OMCLzjCF+7wiFP84hrvJEAOpEEmJEM+pERWJEZupEeGJEmepEq2JCxq9jbSvuUTBH/JfoqyUv3AKs0Dq7UOrtE+tFbn8Drdw+v1jmzQP7rB4NhGemZ0fLPxiS0mJ7eantpmdooibrc4E2h5JsjqbLD1uR0250Nsz4fYXaC1dHeXw6UwqjzxcrjTlQhnuBrpci3K9VoUjXe7HuNeG+NRK5+B5404TmLSzXgvuJXgLZPoc1vG93aSzB0ZP5nkP0L5Kmn0YfmtRB8mKKOUscxnC7vYyF62owEl6EGVIg+dqEUzytGPC7zgCF+4wyNO8YtrvJMAOZAGmZAM+ZASWZEYuZEeGZIkeZKqqNZfIlUvmyD4Q/YuV9u7Qn3fSo39FGiV1oHV2gfW6Bxcq3tond7h9fqHqRqF22h0dJPxsc0mx7eYnthqdmKb+cltVNPyVKDV6SDrM/Q12ObsDttzIXbnQu3Phzpc2Ol4YRfNnngxzOlSuDNcjnC5HOF6JdL1SpTbVYh2vxbtcS0GPK9D7CSohTivcW7Ee/85bz9cOzJBJsbzmowH89nCLjayl+1oUMSgCm0oRCdq0Yxy9OMCLzjCF+7wiFP84hrvJEAOpEEmJEM+pERWJEZupEeGJEmeolR/iLT7twmCP2HPMrXq5XRIc+9KrX2rtPev1oGaNboH1uodXKd/cL3BoQ2GhzcaHd5ofGSTydHNpse2mB3bYn58KzW1PEFft1udDLQ+FWRzOtgWzuywOxNifzbE4axcccdzOyee3wVOF8Kc4WK4C1yKcJWJdLss4345SuZKlIdMtIInXP0jrowy8tjIK8rr8pxIN2Yqw5VFylK2owEl6EEV2lCITkUwytGPC7zgCF+4wyNO8YtrvJMAOZAGmZCMEhFZkRi5kR4ZiiL9CVLVrxME7+E3td3L1Pcs06herlm9QmvvSu19q+gZbdOtWaN3YK3+gXUGB9cbHlpPHSmlyZFNFNT06Gazo/R1q8XxrZbHt1FisD4ZSKdtTgXRb1pO14HSU30OgDPgGJzg/C5nhQthLqOEcznjuF2M+Ovw7diTvDU+YXymsoJdbGQv22UNO+zRgyq0KSJRi2aUox8XeMGRYg2POMUvrvFOAuSgBEIy5ENKZEVi5EZ6okJ/jlTxywTB30Llr2qVv1EpiqW5e7nWnhXa1St1YO8q3X2r9fat0d+/1qBmrWHNOqMDcjuND24wObTR9NAms8Ow2fzIZnpseVQutNWxbdbHYbvNiUBbmSC7kxBsf0rG4dQOh9M7HE+HwMQzEApOCmdhJzi/D/nJM78jzzkt48hk5stbgu3ZyF62KzLQgyq0oRCdqEUzytGPC7zgCF+4wyNO8YtrvJOAEgWZkAz5kBJZkZiozd+CVPbzBMHfTvkvauW/qlf8Ssk0K2kbnVuuvXuFzp6VuntW6VWv0t+7Wn/vGtppuG+t0f51xjWw3uTABlM4uNHs4CbzQyCX2/IwLd9idWQrWB/dZgPHttsqHA+0G8H+eJD9CRkHmeBRTgY7/jnjT46+GCTPkaeNjB3foixlu6xhixV6UIU2FKITtYps9OMCLzjCF+7wiFP84hrvJEAOpEEmJEM+pCSq8rcjlSz9RvCvZ0Ip8VE1CverRgXlW6ZVuVwbqigl1VypJ3eUsq42qKa4a8FoHz2mzetN9q83raHcG8wOUPSN5gfk0lsc3AzcgOWhLVZweCtYKxzhVN7B9ggn9Efwufztu8+Pz2GmMpwtB2Us2Mt2WcNGM/SgCm0oVKSiGeXoxwVecIQv3OFRMYtrvJMAOZAGmZCMqMe/Fqnop28E/2aKl04o/lmt5Gf1kl/US+Uuapb9plW+TBsqlutUrNCthJV6VSv1q1bp715lsHu14Z41YFS9Foz3rjMZwXTf+hE2mO2XMd+/UaZmo0XNJgXLAwqbFazex8hjI6/UyIwM2WihjJXnbzBjl7KU7YoM9KAKbShEJ2rRjHL04wIvOFKs4RGn+MU13kmAHEQZ/s1IhUu+Efz7KfppQtFSukgjOUjaSUdpqlbZb7RWR2Y5JabKFJpaU24qDiN1X220B9YYK1SvNRlBOQ8Fs73rZfaNYv4+5MeUV+R3x+YwUxk+vou9u2UMUSLrWWmANhSiE7VoVsTjAi84whfu8IhT/OJa/NX/+5HyF38j+A+kYMmEgiVqhT+pFco11Sj6mcpqFv9CfbVKftWG0t90oGyZbtkyvbLleuXL9ctXyFSsMKhYCYaVsAqMoApWg/Hb7F5j8uf8f8/LE0amjSDPr5AxYKOyGg0okfUs01XkKVLRjHL04wIvOMIX7vAo/qL/A5FyF30j+E8ib/GEvMVq+UvU8n9SL/hJo2ApaBb+DFpF8Is2FP+qM4JuyW8KeiXL9Epl9EuXy5QtNxhlxTiGb1P+7h9HGHty7F1llDxzmTxf3jKyjr2KAEUMqgplNNEpq/1JA+XoxwVexF/ofxJS9sJvBH8HchZNkFmslrtYPXeJet4SDRm55Zr5S0ELCn4GbYXCX3TG0C38VbfoHfR+57cx3v7wrYd5V54wNm18PruUpfL2nzRRokhCGwrRqQgWf3F/B6TMH78RqICFE7Jk1LIWqWXLqGfL1deQWQKakAs/gdY4ebAUtN+H/GTuO8jTckbRUBaxUd67SNYgK1k4AVXir+bvj5TxwzeC/yr8yA0oqGUulBm5DXWZRb+TvUjjz3n74dHXF44OlCePrGCXCPy/CFLa918L/hvyjcwP76J8KML574aUsuBrgUCgQqSk774WCAQqREqY/7VAIFAhUvy3XwsEAhUixc77WiAQqBApeu7XAoFAhUiRc74WCAQqRAqf9ZVAIFAhUtjMrwQCgQqRds74SiAQqBApZPpXAoFAhUjB074SCAQqRAoM+EogEKgQafvUrwQCgQqRtk75SiAQqBBp8+QvBQKBCpE2+n8pEAhUiLTe70uBQKBCpHW+XwoEAhUirfH5UiAQqBBplfeXAoFAhUgrvL4UCAQqRFo26UuBQKBCpN88vxAIBCpE+sXjC4FAoEKkpe5fCAQCFSItcftCIBCoEGmR6xcCgUCFSD+6fCEQCFSI9IPzFwKBQIVIC5y+EAgEKkSa7/i5QCBQIdI8h88FAoEKkebafy4QCFSINNvuc4FAoEKkmbafCwQCFSJNt/lcIBCoECnA+nOBQKBCpKlWnwsEAhUiTbb8TCAQqBDJz+IzgUCgQiQf888EAoEKkbzMPhMIBCpEmmT6mUAgUCGSh8lnAoFAhUhuxp8JBAIVIrkYfSYQCFSI5GT4qUAgUCHSRINPBQKBCpEc9D8VCAQqRLLT+1QgEKgQyUb3U4FAoEIkK51PBQKBCpEstT8VCAQqRDLX+lQgEKgQyVTjE4FAoEIkY/VPBAKBCpEM1T4RCAQqRDKY8IlAIFAhkt43nwgEAhUi6Xz9iUAgUCGS1lefCAQCFSJpfPmJQCBQIZL6Fx8LBAIVIk34/GOBQKBCpK8/+1ggEKgQ6ctPPxYIBCpE+vyTjwUCgQqRPvv4Y4FAoEKkTz76WCAQqBDpo//7sUAgUCHSv/zLRwKBQIVI//x/PhIIBCpE+qd//kggEKgQ6R//6SOBQKBCpH/43x8JBAIVIv3Pf/xIIBCoEOl//K+PBAKBCvl/8QtJRsq7/F4AAAAASUVORK5CYII=';

export interface SeedTarget {
  organizationId: string;
  workspaceId: string;
}

export interface SeedSummary {
  contacts: number;
  companies: number;
  segments: number;
  templates: number;
  campaigns: number;
  sends: number;
  journeys: number;
  scoringRules: number;
  forms: number;
  meetings: number;
  pipelineName: string;
  stages: number;
  deals: number;
  tasks: number;
  writeKey: string;
}

/** Validate a JSON document against its schema, then hand it to Prisma.
 *  Parsing here means the seed can never write a document the app would
 *  reject — the demo data is correct by construction. */
function json(
  schema: { parse: (value: unknown) => unknown },
  value: unknown,
): Prisma.InputJsonValue {
  return schema.parse(value) as Prisma.InputJsonValue;
}

/**
 * Fill a workspace with the full-platform demo showroom: contacts, lists,
 * segments, templates, campaigns with sends, three journeys, growth
 * surfaces, scheduling, and a CRM pipeline. Idempotent for a given
 * `idPrefix`; pass a distinct prefix (and write key) to seed a second
 * workspace while the quickstart one exists — fixed ids would otherwise
 * collide across workspaces.
 *
 * Used by `prisma/seed.ts` (the quickstart workspace) and by the demo
 * video / screenshot tooling (throwaway showrooms).
 */
export async function seedDemoWorkspace(
  prisma: PrismaClient,
  ws: SeedTarget,
  {
    idPrefix = 'demo',
    writeKeyValue = 'wk_demo_0000000000000000000000000',
    // Email image URLs must be absolute (inbox clients fetch them); the
    // hero asset below is served from this instance's /a route.
    baseUrl = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  } = {},
): Promise<SeedSummary> {
  // ── Contacts ─────────────────────────────────────────────────────────
  // A spread of plans, scores, and AI predictions so segments, lead
  // scoring, and the churn/conversion columns all have something to show.
  type Seed = {
    email: string;
    firstName: string;
    lastName: string;
    company: string;
    plan: string;
    score: number;
    status?: 'ACTIVE' | 'UNSUBSCRIBED';
    conversionProbability?: number;
    churnRisk?: number;
    bestSendHour?: number;
  };
  const demoContacts: Seed[] = [
    {
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      company: 'Analytical Engines',
      plan: 'pro',
      score: 86,
      conversionProbability: 0.82,
      churnRisk: 0.1,
      bestSendHour: 9,
    },
    {
      email: 'grace@example.com',
      firstName: 'Grace',
      lastName: 'Hopper',
      company: 'US Navy',
      plan: 'pro',
      score: 64,
      conversionProbability: 0.71,
      churnRisk: 0.18,
    },
    {
      email: 'radia@example.com',
      firstName: 'Radia',
      lastName: 'Perlman',
      company: 'Spanning Tree',
      plan: 'pro',
      score: 73,
      conversionProbability: 0.66,
      churnRisk: 0.22,
      bestSendHour: 14,
    },
    {
      email: 'margaret@example.com',
      firstName: 'Margaret',
      lastName: 'Hamilton',
      company: 'Apollo',
      plan: 'pro',
      score: 78,
      conversionProbability: 0.75,
      churnRisk: 0.14,
    },
    {
      email: 'alan@example.com',
      firstName: 'Alan',
      lastName: 'Turing',
      company: 'Bletchley Park',
      plan: 'trial',
      score: 35,
      conversionProbability: 0.44,
      churnRisk: 0.4,
    },
    {
      email: 'katherine@example.com',
      firstName: 'Katherine',
      lastName: 'Johnson',
      company: 'NASA',
      plan: 'trial',
      score: 28,
      conversionProbability: 0.33,
      churnRisk: 0.52,
    },
    {
      email: 'annie@example.com',
      firstName: 'Annie',
      lastName: 'Easley',
      company: 'NASA Lewis',
      plan: 'trial',
      score: 41,
      conversionProbability: 0.5,
      churnRisk: 0.33,
    },
    {
      email: 'edsger@example.com',
      firstName: 'Edsger',
      lastName: 'Dijkstra',
      company: 'THE',
      plan: 'free',
      score: 12,
      conversionProbability: 0.12,
      churnRisk: 0.71,
    },
    {
      email: 'hedy@example.com',
      firstName: 'Hedy',
      lastName: 'Lamarr',
      company: 'Spread Spectrum',
      plan: 'free',
      score: 19,
      conversionProbability: 0.2,
      churnRisk: 0.6,
    },
    {
      email: 'barbara@example.com',
      firstName: 'Barbara',
      lastName: 'Liskov',
      company: 'Substitution',
      plan: 'free',
      score: 8,
      status: 'UNSUBSCRIBED',
    },
  ];

  // A second wave of generated contacts so lists, segments, and the
  // contacts table feel like a working install, not a toy. Deterministic
  // (index-derived) traits keep re-seeds idempotent.
  const WAVE_NAMES: Array<[string, string]> = [
    ['Linus', 'Sequoia'],
    ['Maya', 'Castellan'],
    ['Theo', 'Brandt'],
    ['Ines', 'Okafor'],
    ['Ravi', 'Menon'],
    ['Sofia', 'Marquez'],
    ['James', 'Wu'],
    ['Amara', 'Diallo'],
    ['Felix', 'Norden'],
    ['Yuki', 'Tanaka'],
    ['Clara', 'Voss'],
    ['Omar', 'Haddad'],
    ['Nina', 'Petrova'],
    ['Lucas', 'Ferreira'],
    ['Aisha', 'Khan'],
    ['Erik', 'Lindqvist'],
    ['Priya', 'Sharma'],
    ['Tomás', 'Silva'],
    ['Hana', 'Kim'],
    ['Leo', 'Moreau'],
  ];
  const WAVE_COMPANIES = ['DataPipe', 'CloudNine', 'Brightline', 'Nordwind', 'Solstice Labs'];
  const WAVE_COUNTRIES = ['US', 'DE', 'FR', 'JP', 'BR', 'IN'];
  const plans = ['pro', 'trial', 'free'] as const;
  for (const [index, [firstName, lastName]] of WAVE_NAMES.entries()) {
    const plan = plans[index % 3]!;
    const score = (index * 13) % 97;
    demoContacts.push({
      email: `${firstName
        .toLowerCase()
        .normalize('NFD')
        .replace(/[^a-z]/g, '')}.${lastName
        .toLowerCase()
        .normalize('NFD')
        .replace(/[^a-z]/g, '')}@example.com`,
      firstName,
      lastName,
      company: WAVE_COMPANIES[index % WAVE_COMPANIES.length]!,
      plan,
      score,
      status: index === 7 ? 'UNSUBSCRIBED' : undefined,
      conversionProbability: Number((((index * 17) % 90) / 100 + 0.05).toFixed(2)),
      churnRisk: Number((((index * 23) % 80) / 100 + 0.05).toFixed(2)),
      bestSendHour: index % 4 === 0 ? 8 + (index % 10) : undefined,
    });
  }
  for (const [index, contact] of demoContacts.entries()) {
    // Country rounds out the profile page and segment examples.
    (contact as Seed & { country?: string }).country = WAVE_COUNTRIES[index % 6];
  }

  const predictedAt = new Date();
  const contacts = await Promise.all(
    demoContacts.map((c) =>
      prisma.contact.upsert({
        where: { workspaceId_email: { workspaceId: ws.workspaceId, email: c.email } },
        update: {},
        create: {
          id: newId('contact'),
          ...ws,
          email: c.email,
          firstName: c.firstName,
          lastName: c.lastName,
          attributes: {
            plan: c.plan,
            company: c.company,
            country: (c as Seed & { country?: string }).country ?? 'US',
          },
          score: c.score,
          status: c.status ?? 'ACTIVE',
          conversionProbability: c.conversionProbability ?? null,
          churnRisk: c.churnRisk ?? null,
          predictionModel: c.conversionProbability !== undefined ? 'seed-demo-v1' : null,
          predictionComputedAt: c.conversionProbability !== undefined ? predictedAt : null,
          bestSendHour: c.bestSendHour ?? null,
          source: 'seed',
        },
      }),
    ),
  );
  const byEmail = new Map(contacts.map((c) => [c.email, c]));

  // ── Lists ────────────────────────────────────────────────────────────
  const proList = await prisma.contactList.upsert({
    where: { workspaceId_name: { workspaceId: ws.workspaceId, name: 'Pro customers' } },
    update: {},
    create: { id: newId('list'), ...ws, name: 'Pro customers' },
  });
  await prisma.contactListMember.createMany({
    data: contacts
      .filter((c) => (c.attributes as Record<string, string>).plan === 'pro')
      .map((c) => ({ listId: proList.id, contactId: c.id, organizationId: ws.organizationId })),
    skipDuplicates: true,
  });

  // ── Companies (B2B accounts the contacts roll up to) ─────────────────
  const companyDefs = [
    { name: 'Analytical Engines', domain: 'analyticalengines.example', industry: 'Software' },
    { name: 'DataPipe', domain: 'datapipe.example', industry: 'Data infrastructure' },
    { name: 'CloudNine', domain: 'cloudnine.example', industry: 'Cloud hosting' },
    { name: 'Brightline', domain: 'brightline.example', industry: 'E-commerce' },
    { name: 'Nordwind', domain: 'nordwind.example', industry: 'Logistics' },
    { name: 'Solstice Labs', domain: 'solsticelabs.example', industry: 'Biotech' },
  ];
  const companyByName = new Map<string, string>();
  for (const def of companyDefs) {
    const row = await prisma.company.upsert({
      where: { workspaceId_name: { workspaceId: ws.workspaceId, name: def.name } },
      update: {},
      create: {
        id: newId('co'),
        ...ws,
        name: def.name,
        domain: def.domain,
        industry: def.industry,
        website: `https://${def.domain}`,
      },
    });
    companyByName.set(def.name, row.id);
  }
  for (const contact of contacts) {
    const companyName = (contact.attributes as Record<string, string>).company;
    const companyId = companyName ? companyByName.get(companyName) : undefined;
    if (companyId && contact.companyId !== companyId) {
      await prisma.contact.update({ where: { id: contact.id }, data: { companyId } });
    }
  }

  // ── Segments (live predicates over the contacts above) ───────────────
  const segments: Array<{ name: string; description: string; rule: unknown }> = [
    {
      name: 'Engaged pro customers',
      description: 'Pro plan with a lead score of 50 or more',
      rule: {
        kind: 'group',
        op: 'and',
        children: [
          { kind: 'condition', target: 'attribute', key: 'plan', operator: 'equals', value: 'pro' },
          { kind: 'condition', target: 'score', operator: 'gte', value: 50 },
        ],
      },
    },
    {
      name: 'Trial signups',
      description: 'Everyone currently on a trial',
      rule: {
        kind: 'group',
        op: 'and',
        children: [
          {
            kind: 'condition',
            target: 'attribute',
            key: 'plan',
            operator: 'equals',
            value: 'trial',
          },
        ],
      },
    },
    {
      name: 'High intent',
      description: 'Likely to convert — high score or AI conversion propensity',
      rule: {
        kind: 'group',
        op: 'or',
        children: [
          { kind: 'condition', target: 'score', operator: 'gte', value: 70 },
          {
            kind: 'condition',
            target: 'prediction',
            metric: 'conversionProbability',
            operator: 'gte',
            value: 0.6,
          },
        ],
      },
    },
  ];
  const segmentByName = new Map<string, { id: string }>();
  for (const s of segments) {
    const row = await prisma.segment.upsert({
      where: { workspaceId_name: { workspaceId: ws.workspaceId, name: s.name } },
      update: {},
      create: {
        id: newId('seg'),
        ...ws,
        name: s.name,
        description: s.description,
        rule: json(segmentRuleSchema, s.rule),
      },
    });
    segmentByName.set(s.name, row);
  }

  // ── Hero image asset (served by /a/<id>, like a real upload) ─────────
  const heroAssetId = `ast_${idPrefix}_hero`;
  await prisma.emailAsset.upsert({
    where: { id: heroAssetId },
    update: {},
    create: {
      id: heroAssetId,
      ...ws,
      filename: 'acme-dawn.png',
      contentType: 'image/png',
      sizeBytes: Buffer.from(HERO_PNG_BASE64, 'base64').length,
      bytes: Buffer.from(HERO_PNG_BASE64, 'base64'),
    },
  });

  // ── Email templates ──────────────────────────────────────────────────
  const welcome = await prisma.emailTemplate.upsert({
    where: {
      workspaceId_name: { workspaceId: ws.workspaceId, name: 'Welcome series — first email' },
    },
    update: {},
    create: {
      id: newId('tpl'),
      ...ws,
      name: 'Welcome series — first email',
      subject: 'Welcome to Acme, {{firstName|there}} 👋',
      document: json(emailDocumentSchema, {
        blocks: [
          { id: 'b1', type: 'heading', text: 'You are in, {{firstName|there}}' },
          {
            id: 'b2',
            type: 'paragraph',
            text: 'Thanks for joining Acme. Here is everything you need to get your first automation live in minutes.',
          },
          { id: 'b3', type: 'button', label: 'Open the dashboard', url: 'https://example.com/app' },
          { id: 'b4', type: 'divider' },
          {
            id: 'b5',
            type: 'paragraph',
            text: 'Reply any time — a real human reads every message.',
          },
        ],
      }),
    },
  });

  const productUpdate = await prisma.emailTemplate.upsert({
    where: { workspaceId_name: { workspaceId: ws.workspaceId, name: 'Product update' } },
    update: {},
    create: {
      id: newId('tpl'),
      ...ws,
      name: 'Product update',
      subject: 'New this month at Acme',
      document: json(emailDocumentSchema, {
        blocks: [
          {
            id: 'b0',
            type: 'image',
            url: `${baseUrl}/a/${heroAssetId}`,
            alt: 'Acme at dawn',
            width: 100,
            align: 'center',
            radius: 12,
          },
          { id: 'b1', type: 'heading', text: 'Fresh from the workshop' },
          {
            id: 'b2',
            type: 'paragraph',
            text: 'Hi {{firstName|there}}, here is what shipped this month — including faster journeys and a new AI copilot.',
          },
          {
            id: 'b3',
            type: 'button',
            label: 'See what changed',
            url: 'https://example.com/changelog',
          },
        ],
      }),
    },
  });

  const trialEnding = await prisma.emailTemplate.upsert({
    where: { workspaceId_name: { workspaceId: ws.workspaceId, name: 'Trial ending soon' } },
    update: {},
    create: {
      id: newId('tpl'),
      ...ws,
      name: 'Trial ending soon',
      subject: 'Your Acme trial ends in 3 days, {{firstName|there}}',
      document: json(emailDocumentSchema, {
        blocks: [
          { id: 'b1', type: 'heading', text: 'Keep your automations running' },
          {
            id: 'b2',
            type: 'paragraph',
            text: 'Your trial wraps up this week. Upgrade now and everything you built — segments, journeys, templates — keeps working without a blip.',
          },
          { id: 'b3', type: 'button', label: 'Upgrade to Pro', url: 'https://example.com/upgrade' },
          { id: 'b4', type: 'divider' },
          { id: 'b5', type: 'paragraph', text: 'Questions? Just reply — we read everything.' },
        ],
      }),
    },
  });

  const winBack = await prisma.emailTemplate.upsert({
    where: { workspaceId_name: { workspaceId: ws.workspaceId, name: 'Win-back — we miss you' } },
    update: {},
    create: {
      id: newId('tpl'),
      ...ws,
      name: 'Win-back — we miss you',
      subject: 'It has been a while, {{firstName|there}}',
      document: json(emailDocumentSchema, {
        blocks: [
          { id: 'b1', type: 'heading', text: 'Your workspace is still here' },
          {
            id: 'b2',
            type: 'paragraph',
            text: 'A lot shipped since you last logged in. Pick up where you left off — your data never went anywhere.',
          },
          { id: 'b3', type: 'button', label: 'Come back in', url: 'https://example.com/app' },
        ],
      }),
    },
  });

  // ── Campaign (a draft the operator can review and send) ──────────────
  await prisma.campaign.upsert({
    where: { workspaceId_name: { workspaceId: ws.workspaceId, name: 'Monthly product update' } },
    update: {},
    create: {
      id: newId('cmp'),
      ...ws,
      name: 'Monthly product update',
      templateId: productUpdate.id,
      // Subject-line A/B test: template.subject is variant A.
      subjectB: 'Your Acme changelog for this month 🚀',
      segmentId: segmentByName.get('Engaged pro customers')?.id ?? null,
      status: 'DRAFT',
    },
  });

  // A sent campaign with per-contact sends so the dashboard KPIs, campaign
  // engagement cards, and attribution all have history to show.
  const roundup = await prisma.campaign.upsert({
    where: { workspaceId_name: { workspaceId: ws.workspaceId, name: 'June feature roundup' } },
    update: {},
    create: {
      id: newId('cmp'),
      ...ws,
      name: 'June feature roundup',
      templateId: productUpdate.id,
      segmentId: segmentByName.get('High intent')?.id ?? null,
      status: 'SENT',
      sentAt: new Date(predictedAt.getTime() - 5 * 86_400_000),
    },
  });
  const sendable = contacts.filter((c) => c.status === 'ACTIVE');
  for (const [index, contact] of sendable.entries()) {
    // Deterministic ids keep re-runs from duplicating sends.
    const id = `snd_${idPrefix}_${index + 1}`;
    await prisma.emailSend.upsert({
      where: { id },
      update: {},
      create: {
        id,
        ...ws,
        contactId: contact.id,
        campaignId: roundup.id,
        email: contact.email,
        subject: 'New this month at Acme',
        status: 'SENT',
        sentAt: new Date(predictedAt.getTime() - ((index % 12) + 1) * 86_400_000),
      },
    });
  }

  // A second sent campaign so engagement charts have more than one series
  // of history: the trial nudge, sent to everyone currently on a trial.
  const trialNudge = await prisma.campaign.upsert({
    where: { workspaceId_name: { workspaceId: ws.workspaceId, name: 'Trial ending nudge' } },
    update: {},
    create: {
      id: newId('cmp'),
      ...ws,
      name: 'Trial ending nudge',
      templateId: trialEnding.id,
      segmentId: segmentByName.get('Trial signups')?.id ?? null,
      status: 'SENT',
      sentAt: new Date(predictedAt.getTime() - 2 * 86_400_000),
    },
  });
  const trialContacts = contacts.filter(
    (c) => c.status === 'ACTIVE' && (c.attributes as Record<string, string>).plan === 'trial',
  );
  for (const [index, contact] of trialContacts.entries()) {
    const id = `snd_${idPrefix}_t${index + 1}`;
    await prisma.emailSend.upsert({
      where: { id },
      update: {},
      create: {
        id,
        ...ws,
        contactId: contact.id,
        campaignId: trialNudge.id,
        email: contact.email,
        subject: 'Your Acme trial ends in 3 days',
        status: 'SENT',
        sentAt: new Date(predictedAt.getTime() - ((index % 3) + 1) * 86_400_000),
      },
    });
  }

  // ── In-app message (referenced by the trial-conversion journey) ──────
  const inAppUpgrade = await prisma.inAppMessage.upsert({
    where: { id: `iam_${idPrefix}_upgrade` },
    update: {},
    create: {
      id: `iam_${idPrefix}_upgrade`,
      ...ws,
      name: 'Upgrade nudge',
      title: 'Unlock every channel',
      body: 'Your trial includes journeys, SMS, and the AI copilot — upgrade to keep them after day 14.',
      ctaLabel: 'See plans',
      ctaUrl: 'https://example.com/pricing',
      active: true,
    },
  });

  // ── Journey (an active welcome series — survives worker restarts) ─────
  await prisma.journey.upsert({
    where: { workspaceId_name: { workspaceId: ws.workspaceId, name: 'Welcome series' } },
    update: {},
    create: {
      id: newId('jny'),
      ...ws,
      name: 'Welcome series',
      status: 'ACTIVE',
      definition: json(journeyDefinitionSchema, {
        trigger: { type: 'event', event: 'Signed Up' },
        startNodeId: 'welcome',
        quietHours: { start: '21:00', end: '08:00', timezone: 'UTC' },
        frequencyCap: { maxEmails: 3, perDays: 7 },
        nodes: [
          {
            id: 'welcome',
            type: 'send_email',
            templateId: welcome.id,
            position: { x: 40, y: 200 },
          },
          { id: 'soak', type: 'wait', seconds: 172800, position: { x: 40, y: 360 } },
          {
            id: 'is_pro',
            type: 'branch',
            condition: {
              kind: 'condition',
              target: 'attribute',
              key: 'plan',
              operator: 'equals',
              value: 'pro',
            },
            position: { x: 40, y: 520 },
          },
          {
            id: 'upsell',
            type: 'send_email',
            templateId: productUpdate.id,
            position: { x: 320, y: 680 },
          },
          {
            id: 'mark',
            type: 'update_trait',
            key: 'journey',
            value: 'welcomed',
            position: { x: -240, y: 680 },
          },
          { id: 'done', type: 'end', position: { x: 40, y: 840 } },
        ],
        edges: [
          { from: 'welcome', to: 'soak' },
          { from: 'soak', to: 'is_pro' },
          { from: 'is_pro', to: 'mark', label: 'yes' },
          { from: 'is_pro', to: 'upsell', label: 'no' },
          { from: 'mark', to: 'done' },
          { from: 'upsell', to: 'done' },
        ],
      }),
    },
  });

  // A multi-channel journey — the canvas showpiece: email, an A/B split
  // into SMS vs WhatsApp, and an in-app nudge, all in one flow.
  await prisma.journey.upsert({
    where: { workspaceId_name: { workspaceId: ws.workspaceId, name: 'Trial conversion' } },
    update: {},
    create: {
      id: newId('jny'),
      ...ws,
      name: 'Trial conversion',
      status: 'ACTIVE',
      definition: json(journeyDefinitionSchema, {
        trigger: { type: 'event', event: 'Trial Started' },
        startNodeId: 'heads_up',
        quietHours: { start: '21:00', end: '08:00', timezone: 'UTC' },
        frequencyCap: { maxEmails: 3, perDays: 7 },
        nodes: [
          {
            id: 'heads_up',
            type: 'send_email',
            templateId: trialEnding.id,
            optimizeSendTime: true,
            position: { x: 40, y: 160 },
          },
          { id: 'soak', type: 'wait', seconds: 86_400, position: { x: 40, y: 320 } },
          { id: 'split', type: 'ab_split', ratioA: 50, position: { x: 40, y: 480 } },
          {
            id: 'nudge_sms',
            type: 'send_sms',
            body: 'Hi {{firstName|there}} — your Acme trial ends in 3 days. Upgrade: https://example.com/upgrade',
            position: { x: -240, y: 640 },
          },
          {
            id: 'nudge_wa',
            type: 'send_whatsapp',
            body: 'Hi {{firstName|there}}! Quick heads-up: your Acme trial wraps up this week.',
            position: { x: 320, y: 640 },
          },
          {
            id: 'in_app',
            type: 'send_in_app',
            messageId: inAppUpgrade.id,
            position: { x: 40, y: 800 },
          },
          { id: 'done', type: 'end', position: { x: 40, y: 960 } },
        ],
        edges: [
          { from: 'heads_up', to: 'soak' },
          { from: 'soak', to: 'split' },
          { from: 'split', to: 'nudge_sms', label: 'a' },
          { from: 'split', to: 'nudge_wa', label: 'b' },
          { from: 'nudge_sms', to: 'in_app' },
          { from: 'nudge_wa', to: 'in_app' },
          { from: 'in_app', to: 'done' },
        ],
      }),
    },
  });

  // A draft the operator can finish: branch + webhook handoff.
  await prisma.journey.upsert({
    where: { workspaceId_name: { workspaceId: ws.workspaceId, name: 'Win-back inactive users' } },
    update: {},
    create: {
      id: newId('jny'),
      ...ws,
      name: 'Win-back inactive users',
      status: 'DRAFT',
      definition: json(journeyDefinitionSchema, {
        trigger: { type: 'event', event: 'Became Inactive' },
        startNodeId: 'miss_you',
        nodes: [
          {
            id: 'miss_you',
            type: 'send_email',
            templateId: winBack.id,
            position: { x: 40, y: 160 },
          },
          { id: 'soak', type: 'wait', seconds: 3 * 86_400, position: { x: 40, y: 320 } },
          {
            id: 'still_free',
            type: 'branch',
            condition: {
              kind: 'condition',
              target: 'attribute',
              key: 'plan',
              operator: 'equals',
              value: 'free',
            },
            position: { x: 40, y: 480 },
          },
          {
            id: 'crm_handoff',
            type: 'webhook',
            url: 'https://example.com/hooks/sales-handoff',
            position: { x: -240, y: 640 },
          },
          { id: 'done', type: 'end', position: { x: 40, y: 800 } },
        ],
        edges: [
          { from: 'miss_you', to: 'soak' },
          { from: 'soak', to: 'still_free' },
          { from: 'still_free', to: 'crm_handoff', label: 'yes' },
          { from: 'still_free', to: 'done', label: 'no' },
          { from: 'crm_handoff', to: 'done' },
        ],
      }),
    },
  });

  // ── Lead-scoring rules (applied by the worker's event consumer) ──────
  const scoringRules: Array<{ event: string; points: number }> = [
    { event: 'Pricing Viewed', points: 10 },
    { event: 'Added to Cart', points: 25 },
    { event: 'Converted', points: 100 },
  ];
  for (const rule of scoringRules) {
    await prisma.scoringRule.upsert({
      where: { workspaceId_event: { workspaceId: ws.workspaceId, event: rule.event } },
      update: {},
      create: { id: newId('score'), ...ws, event: rule.event, points: rule.points },
    });
  }

  // ── Hosted signup forms ──────────────────────────────────────────────
  await prisma.form.upsert({
    where: { workspaceId_name: { workspaceId: ws.workspaceId, name: 'Newsletter' } },
    update: {},
    create: { id: newId('form'), ...ws, name: 'Newsletter', title: 'Join the Acme newsletter' },
  });
  await prisma.form.upsert({
    where: { workspaceId_name: { workspaceId: ws.workspaceId, name: 'Beta waitlist' } },
    update: {},
    create: { id: newId('form'), ...ws, name: 'Beta waitlist', title: 'Get early access to Acme' },
  });

  // ── Landing page, on-site widget, and a booking page ─────────────────
  await prisma.landingPage.upsert({
    where: { id: `lp_${idPrefix}_launch` },
    update: {},
    create: {
      id: `lp_${idPrefix}_launch`,
      ...ws,
      title: 'Fall launch',
      published: true,
      blocks: json(landingDocumentSchema, [
        { type: 'heading', text: 'Acme ships its biggest release yet' },
        {
          type: 'text',
          text: 'Faster automations, a smarter copilot, and every channel in one place. Be first in line when it lands.',
        },
        { type: 'form', buttonLabel: 'Save my spot' },
        { type: 'button', label: 'Read the announcement', href: 'https://example.com/blog' },
      ]),
    },
  });

  await prisma.widget.upsert({
    where: { id: `wdg_${idPrefix}_launch` },
    update: {},
    create: {
      id: `wdg_${idPrefix}_launch`,
      ...ws,
      name: 'Fall launch banner',
      type: 'BANNER',
      title: 'The fall release is here',
      body: 'New journeys, new channels, same price.',
      ctaLabel: 'See what changed',
      ctaUrl: 'https://example.com/changelog',
      active: true,
    },
  });

  await prisma.widget.upsert({
    where: { id: `wdg_${idPrefix}_exit` },
    update: {},
    create: {
      id: `wdg_${idPrefix}_exit`,
      ...ws,
      name: 'Exit-intent offer',
      type: 'POPUP',
      title: 'Before you go…',
      body: 'Start with the annual plan and get two months free.',
      ctaLabel: 'Claim the offer',
      ctaUrl: 'https://example.com/annual',
      active: false,
    },
  });

  const bookingPage = await prisma.bookingPage.upsert({
    where: { id: `bpg_${idPrefix}_intro` },
    update: {},
    create: {
      id: `bpg_${idPrefix}_intro`,
      ...ws,
      title: 'Intro call',
      description: 'Thirty minutes with the Acme team — bring your questions.',
      durationMinutes: 30,
      timezone: 'Europe/Paris',
      availability: availabilitySchema.parse(DEFAULT_AVAILABILITY) as Prisma.InputJsonValue,
      bufferMinutes: 0,
      enabled: true,
    },
  });
  // Two upcoming meetings, pinned to weekday mornings so they are always
  // in the future and never collide with the unique (page, startAt).
  const nextWeekday = (from: Date, daysAhead: number, utcHour: number): Date => {
    const date = new Date(from);
    date.setUTCDate(date.getUTCDate() + daysAhead);
    while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
      date.setUTCDate(date.getUTCDate() + 1);
    }
    date.setUTCHours(utcHour, 30, 0, 0);
    return date;
  };
  // Distinct hours: weekend seeds advance both meetings to the same Monday,
  // and the unique (page, startAt) must still hold.
  const invitees = [
    { n: 1, daysAhead: 1, utcHour: 8, email: 'sofia@datapipe.example', name: 'Sofia Marquez' },
    { n: 2, daysAhead: 2, utcHour: 10, email: 'james@cloudnine.example', name: 'James Wu' },
  ];
  for (const invitee of invitees) {
    const id = `mtg_${idPrefix}_${invitee.n}`;
    const startAt = nextWeekday(predictedAt, invitee.daysAhead, invitee.utcHour);
    await prisma.meeting.upsert({
      where: { id },
      update: { startAt },
      create: {
        id,
        ...ws,
        bookingPageId: bookingPage.id,
        startAt,
        durationMinutes: 30,
        inviteeEmail: invitee.email,
        inviteeName: invitee.name,
        status: 'BOOKED',
      },
    });
  }

  // ── CRM: a default pipeline with stages and a few open/won deals ─────
  const pipeline = await prisma.pipeline.upsert({
    where: { workspaceId_name: { workspaceId: ws.workspaceId, name: 'New business' } },
    update: {},
    create: { id: newId('pipe'), ...ws, name: 'New business', isDefault: true },
  });
  const stageDefs = [
    { key: 'lead', name: 'Lead', kind: 'OPEN' as const },
    { key: 'qualified', name: 'Qualified', kind: 'OPEN' as const },
    { key: 'proposal', name: 'Proposal', kind: 'OPEN' as const },
    { key: 'won', name: 'Won', kind: 'WON' as const },
    { key: 'lost', name: 'Lost', kind: 'LOST' as const },
  ];
  const stageId = new Map<string, string>();
  for (const [position, stage] of stageDefs.entries()) {
    // Deterministic id keeps the stage set idempotent (no natural unique key).
    const id = `stg_${idPrefix}_${stage.key}`;
    await prisma.pipelineStage.upsert({
      where: { id },
      update: {},
      create: { id, ...ws, pipelineId: pipeline.id, name: stage.name, position, kind: stage.kind },
    });
    stageId.set(stage.key, id);
  }

  const deals: Array<{
    n: number;
    title: string;
    cents: number;
    stage: string;
    email?: string;
    status?: 'OPEN' | 'WON';
    pos: number;
  }> = [
    {
      n: 1,
      title: 'Hopper rollout',
      cents: 900_000,
      stage: 'lead',
      email: 'radia@example.com',
      pos: 0,
    },
    {
      n: 2,
      title: 'Johnson onboarding',
      cents: 300_000,
      stage: 'lead',
      email: 'katherine@example.com',
      pos: 1,
    },
    {
      n: 3,
      title: 'Acme Pro — 25 seats',
      cents: 1_500_000,
      stage: 'qualified',
      email: 'grace@example.com',
      pos: 0,
    },
    {
      n: 4,
      title: 'Lovelace Labs annual',
      cents: 4_800_000,
      stage: 'proposal',
      email: 'ada@example.com',
      pos: 0,
    },
    {
      n: 5,
      title: 'Hamilton Aerospace',
      cents: 7_200_000,
      stage: 'won',
      email: 'margaret@example.com',
      status: 'WON',
      pos: 0,
    },
  ];
  for (const deal of deals) {
    const id = `deal_${idPrefix}_${deal.n}`;
    await prisma.deal.upsert({
      where: { id },
      update: {},
      create: {
        id,
        ...ws,
        pipelineId: pipeline.id,
        stageId: stageId.get(deal.stage)!,
        title: deal.title,
        valueCents: deal.cents,
        currency: 'USD',
        status: deal.status ?? 'OPEN',
        position: deal.pos,
        contactId: deal.email ? (byEmail.get(deal.email)?.id ?? null) : null,
        closedAt: deal.status === 'WON' ? predictedAt : null,
      },
    });
  }

  // ── Notes (pinned context on the big deal and the key contact) ───────
  const noteDefs = [
    {
      id: `note_${idPrefix}_1`,
      dealN: 4,
      pinned: true,
      body: 'Legal review done — waiting on their CFO to countersign. Renewal agreed at 1.2x.',
    },
    {
      id: `note_${idPrefix}_2`,
      email: 'ada@example.com',
      pinned: false,
      body: 'Prefers async email over calls. Interested in the AI copilot for campaign drafts.',
    },
  ];
  for (const note of noteDefs) {
    await prisma.note.upsert({
      where: { id: note.id },
      update: {},
      create: {
        id: note.id,
        ...ws,
        body: note.body,
        pinned: note.pinned,
        contactId: 'email' in note && note.email ? (byEmail.get(note.email)?.id ?? null) : null,
        dealId: 'dealN' in note && note.dealN ? `deal_${idPrefix}_${note.dealN}` : null,
      },
    });
  }

  // ── Tasks: a spread of CRM to-dos across the due-date buckets ────────
  const DAY_MS = 86_400_000;
  const demoTasks: Array<{
    n: number;
    title: string;
    type: 'TODO' | 'CALL' | 'EMAIL' | 'MEETING';
    priority: 'LOW' | 'MEDIUM' | 'HIGH';
    dueDays: number | null;
    email?: string;
    deal?: number;
    done?: boolean;
    notes?: string;
  }> = [
    { n: 1, title: 'Call Ada about the annual renewal', type: 'CALL', priority: 'HIGH', dueDays: -2, email: 'ada@example.com', deal: 4 }, // prettier-ignore
    { n: 2, title: 'Send Acme the 25-seat proposal', type: 'EMAIL', priority: 'MEDIUM', dueDays: 0, email: 'grace@example.com', deal: 3 }, // prettier-ignore
    { n: 3, title: 'Kickoff with Hamilton Aerospace', type: 'MEETING', priority: 'MEDIUM', dueDays: 3, email: 'margaret@example.com', deal: 5 }, // prettier-ignore
    { n: 4, title: 'Follow up on the Hopper rollout', type: 'TODO', priority: 'LOW', dueDays: 6, email: 'radia@example.com', deal: 1 }, // prettier-ignore
    { n: 5, title: 'Draft the Q3 nurture sequence', type: 'TODO', priority: 'LOW', dueDays: null, notes: 'Three emails: welcome, value, ask.' }, // prettier-ignore
    { n: 6, title: 'Qualify the Johnson onboarding lead', type: 'CALL', priority: 'MEDIUM', dueDays: -1, email: 'katherine@example.com', deal: 2, done: true }, // prettier-ignore
  ];
  for (const task of demoTasks) {
    const id = `task_${idPrefix}_${task.n}`;
    await prisma.task.upsert({
      where: { id },
      update: {},
      create: {
        id,
        ...ws,
        title: task.title,
        type: task.type,
        priority: task.priority,
        status: task.done ? 'DONE' : 'OPEN',
        dueAt:
          task.dueDays === null ? null : new Date(predictedAt.getTime() + task.dueDays * DAY_MS),
        completedAt: task.done ? new Date(predictedAt.getTime() - DAY_MS) : null,
        notes: task.notes ?? null,
        contactId: task.email ? (byEmail.get(task.email)?.id ?? null) : null,
        dealId: task.deal ? `deal_${idPrefix}_${task.deal}` : null,
      },
    });
  }

  // Deterministic demo write key: local-only, lets the quickstart and the
  // SDK snippet work immediately after `task up`. Never reuse in prod.
  const writeKey = await prisma.writeKey.upsert({
    where: { key: writeKeyValue },
    update: {},
    create: {
      id: newId('wkey'),
      ...ws,
      key: writeKeyValue,
      name: 'Demo browser source',
    },
  });

  await prisma.auditLog.create({
    data: {
      id: newId('audit'),
      ...ws,
      action: 'workspace.seeded',
      targetType: 'workspace',
      targetId: ws.workspaceId,
      metadata: { source: 'prisma/seed.ts' },
    },
  });

  return {
    contacts: contacts.length,
    companies: companyDefs.length,
    segments: segments.length,
    templates: 4,
    campaigns: 3,
    sends: sendable.length + trialContacts.length,
    journeys: 3,
    scoringRules: scoringRules.length,
    forms: 2,
    meetings: invitees.length,
    pipelineName: pipeline.name,
    stages: stageDefs.length,
    deals: deals.length,
    tasks: demoTasks.length,
    writeKey: writeKey.key,
  };
}
