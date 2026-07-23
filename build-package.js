const fs = require('fs');
const path = require('path');
const cp = require('child_process');

console.log('==================================================');
console.log('  💒 PicSelec Windows 무설치 단일 패키지 빌더 💒');
console.log('==================================================\n');

const projectRoot = __dirname;
const distDir = path.join(projectRoot, 'dist_package');
const outputZip = path.join(projectRoot, 'PicSelec_Windows_v1.0.zip');

// 1. 기존 dist 폴더 정리
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

console.log('[1/4] 배포용 필수 파일 복사 중...');

// 복사할 파일 및 폴더 목록
const copyFiles = ['server.js', 'index.html', 'landing.html', 'package.json', 'node_modules'];

for (const file of copyFiles) {
  const src = path.join(projectRoot, file);
  const dest = path.join(distDir, file);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
    console.log(` - 복사 완료: ${file}`);
  }
}

// 2. 현재 시스템의 node.exe 바이너리를 패키지에 동봉
console.log('\n[2/4] 무설치 실행용 Node.js 바이너리(node.exe) 패키지 포함 중...');
const nodeExecPath = process.execPath;
const targetNodePath = path.join(distDir, 'node.exe');
fs.copyFileSync(nodeExecPath, targetNodePath);
console.log(` - node.exe 동봉 완료 (${(fs.statSync(targetNodePath).size / (1024 * 1024)).toFixed(1)}MB)`);

// 3. 한눈에 직관적인 실행 런처 3종 생성
console.log('\n[3/4] 1클릭 직관적 실행 런처 파일들 생성 중...');

const batContent = `@echo off
title PicSelec - Wedding Photo Select Program
cd /d "%~dp0"
echo ==================================================
echo   💒 PicSelec 웨딩 사진 셀렉 프로그램 💒
echo ==================================================
echo.
echo [안내] 별도의 노드(Node.js) 설치 없이 즉시 실행됩니다.
echo.

"%~dp0node.exe" "%~dp0server.js" --tunnel

if errorlevel 1 (
  echo.
  echo [오류] 프로그램 실행 중 문제가 발생했습니다.
  pause
)
`;

const vbsContent = `Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """" & WshShell.CurrentDirectory & "\\node.exe"" """ & WshShell.CurrentDirectory & "\\server.js"" --tunnel", 1, false
`;

const readmeContent = `==================================================
  💒 PicSelec 웨딩 사진 셀렉 프로그램 사용 안내 💒
==================================================

1. [ ▶_PicSelec_프로그램_실행.bat ] 또는 [ ▶_PicSelec_프로그램_실행.vbs ]를 더블 클릭하여 실행하세요.
2. 내 컴퓨터의 브라우저 창이 열리면 사진 폴더와 프로필(신랑/신부)을 지정합니다.
3. 내 컴퓨터 접속 시 PIN 입력 없이 즉시 셀렉을 시작할 수 있습니다.
4. 상단 [📱 QR / 폰 접속] 버튼으로 신부/신랑 휴대폰에서도 실시간 동시 셀렉이 가능합니다.
==================================================
`;

fs.writeFileSync(path.join(distDir, '▶_PicSelec_프로그램_실행.bat'), batContent, 'ascii');
fs.writeFileSync(path.join(distDir, '▶_PicSelec_프로그램_실행.cmd'), batContent, 'ascii');
fs.writeFileSync(path.join(distDir, '▶_PicSelec_프로그램_실행.vbs'), vbsContent, 'ascii');
fs.writeFileSync(path.join(distDir, '★_시작하기_안내.txt'), readmeContent, 'utf8');

console.log(' - ▶_PicSelec_프로그램_실행.bat 생성 완료');
console.log(' - ▶_PicSelec_프로그램_실행.cmd 생성 완료');
console.log(' - ▶_PicSelec_프로그램_실행.vbs 생성 완료');
console.log(' - ★_시작하기_안내.txt 생성 완료');

// 4. 배포용 ZIP 압축 파일 생성
console.log('\n[4/4] 배포용 ZIP 압축 파일 생성 중...');
try {
  const zipCmd = `powershell -Command "Compress-Archive -Path '${distDir}\\*' -DestinationPath '${outputZip}' -Force"`;
  cp.execSync(zipCmd);
  console.log(`\n==================================================`);
  console.log(`  🎉 빌드 완료! 배포용 압축 파일이 생성되었습니다:`);
  console.log(`  📦 ${outputZip}`);
  console.log(`==================================================\n`);
} catch (err) {
  console.log('\n[참고] dist_package 폴더에 패키지 파일들이 준비되었습니다.');
}
