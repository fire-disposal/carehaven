import { SITE } from './content/site'

export default defineAppConfig({
  pages: [
    'pages/login/index',
    'pages/index/index',
    'pages/manage/index',
    'pages/qa/index',
    'pages/community/index',
    'pages/profile/index',
    'pages/assessment/index',
    'pages/feedback/index',
    'pages/about/index',
    'pages/agreement/index',
    'pages/checkin/index',
    'pages/guide/index',
    'pages/records/index',
    'pages/account/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#3E5F4B',
    navigationBarTitleText: SITE.name,
    navigationBarTextStyle: 'white',
    backgroundColor: '#F1ECE3',
  },
})
