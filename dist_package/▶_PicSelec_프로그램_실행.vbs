Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """" & WshShell.CurrentDirectory & "\node.exe"" """ & WshShell.CurrentDirectory & "\server.js"" --tunnel", 1, false
